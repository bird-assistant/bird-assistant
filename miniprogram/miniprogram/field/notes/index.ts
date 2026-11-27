import {blankFieldNote,FieldNote,findFieldNotes,noteTags,readFieldNotes,saveFieldNote,trashFieldNote} from '../../services/field-notes';
import {beijingDateTime} from '../../services/observation-context';
import {isSampleObservation,localRepository} from '../../services/repository';
type Input=WechatMiniprogram.CustomEvent<{value:string}>;
type Tap=WechatMiniprogram.TouchEvent;
const explain=(error:unknown)=>error instanceof Error?error.message:'保存未完成，请重试。';
Page({
  data:{observationError:'',screen:'list',query:'',tag:'',trash:false,rows:[] as Array<FieldNote&{when:string;excerpt:string;linked:string}>,
    tags:[] as string[],count:0,trashCount:0,note:null as FieldNote|null,tagText:'',dirty:false,saved:'',error:'',linkOpen:false,
    observations:[] as Array<{id:string;name:string}>,linkedName:''},
  _saveTimer:0,_visible:false,
  onLoad(){this.reload();},onShow(){this._visible=true;if(this.data.screen==='list')this.reload();},
  onHide(){clearTimeout(this._saveTimer);this.flush();this._visible=false;},
  onUnload(){clearTimeout(this._saveTimer);this.flush();this._visible=false;},
  reload(){try{
    const items=readFieldNotes();let observations:Array<{id:string;name:string}>=[];
    try{observations=localRepository().list().filter(n=>!isSampleObservation(n)).map(n=>({id:n.id,name:n.birdName||'未标注鸟名'}));this.setData({observationError:''});}catch{this.setData({observationError:'本机观察列表暂不可用，笔记仍可独立读写。'});}
    this.setData({observations,rows:findFieldNotes(items,this.data.query,this.data.tag,this.data.trash).map(n=>({...n,when:beijingDateTime(n.updatedAt),excerpt:n.body.trim().slice(0,110),linked:observations.find(o=>o.id===n.observationId)?.name||(n.observationId?'关联记录已移除':'')})),
      tags:Array.from(new Set(items.filter(n=>!n.deletedAt).reduce<string[]>((tags,n)=>tags.concat(n.tags),[]))).sort(),count:items.filter(n=>!n.deletedAt).length,trashCount:items.filter(n=>n.deletedAt).length,error:''});
  }catch(error){this.setData({error:explain(error)});}},
  search(event:Input){this.setData({query:event.detail.value});this.reload();},
  tag(event:Tap){const tag=String(event.currentTarget.dataset.tag||'');this.setData({tag:this.data.tag===tag?'':tag});this.reload();},
  toggleTrash(){this.setData({trash:!this.data.trash,tag:'',query:''});this.reload();},
  create(){this.setData({screen:'edit',note:blankFieldNote(),dirty:false,tagText:'',saved:'尚未填写',error:'',linkedName:'',linkOpen:false});},
  open(event:Tap){try{const note=readFieldNotes().find(n=>n.id===event.currentTarget.dataset.id);if(!note)return;
    this.setData({screen:'edit',note,tagText:note.tags.join('，'),saved:'已保存在本机',dirty:false,error:'',linkOpen:false,
      linkedName:this.data.observations.find(n=>n.id===note.observationId)?.name||(note.observationId?'关联记录已移除':'')});
  }catch(error){this.setData({error:explain(error)});}},
  input(event:Input){const field=String(event.currentTarget.dataset.field),note=this.data.note;if(!note||note.deletedAt)return;
    if(field==='tags')this.setData({tagText:event.detail.value,note:{...note,tags:noteTags(event.detail.value)},dirty:true,saved:'正在保存…'});
    else if(field==='title'||field==='body')this.setData({note:{...note,[field]:event.detail.value},dirty:true,saved:'正在保存…'});
    clearTimeout(this._saveTimer);this._saveTimer=setTimeout(()=>this.flush(),450);
  },
  flush(){clearTimeout(this._saveTimer);const note=this.data.note;if(!note||!this.data.dirty||note.deletedAt)return true;
    try{const saved=saveFieldNote(note.id,note,note.revision);this.setData({note:saved,dirty:false,saved:'已保存在本机',error:''});return true;}
    catch(error){this.setData({saved:'尚未保存',error:explain(error)});return false;}},
  pin(){if(!this.data.note||this.data.note.deletedAt)return;this.setData({note:{...this.data.note,pinned:!this.data.note.pinned},dirty:true});this.flush();},
  links(){this.setData({linkOpen:!this.data.linkOpen});},
  link(event:Tap){const note=this.data.note,id=String(event.currentTarget.dataset.id||'');if(!note||note.deletedAt)return;
    if(id&&!this.data.observations.some(n=>n.id===id))return;
    this.setData({note:{...note,observationId:id},linkedName:this.data.observations.find(n=>n.id===id)?.name||'',linkOpen:false,dirty:true});this.flush();},
  back(){if(this.data.screen==='edit'){if(!this.flush())return;this.setData({screen:'list',note:null,linkOpen:false});this.reload();}
    else wx.navigateBack({fail:()=>wx.switchTab({url:'/pages/profile/index'})});},
  save(){this.flush();},
  saveCopy(){const note=this.data.note;if(!note)return;const copy=blankFieldNote();this.setData({note:{...note,id:copy.id,revision:0,deletedAt:'',createdAt:copy.createdAt},dirty:true});this.flush();},
  copy(){const note=this.data.note;if(!note)return;wx.setClipboardData({data:[note.title,note.body,note.tags.length?'#'+note.tags.join(' #'):''].filter(Boolean).join('\n\n'),fail:()=>this.setData({error:'复制未完成，请重试。'})});},
  trash(){const note=this.data.note;if(!note)return;if(!this.flush())return;
    const saved=this.data.note!;if(!saved.revision){this.setData({screen:'list',note:null});this.reload();return;}
    wx.showModal({title:saved.deletedAt?'还原这篇笔记？':'移入笔记回收站？',content:saved.deletedAt?'将恢复到我的随手记。':'可以在回收站还原。关联的观察原件会保留。',confirmText:saved.deletedAt?'还原':'移入',success:reply=>{
      if(!reply.confirm||this.data.note?.id!==saved.id)return;try{trashFieldNote(saved.id,saved.revision,!!saved.deletedAt);this.setData({screen:'list',note:null,dirty:false});this.reload();}catch(error){this.setData({error:explain(error)});}
    }});
  }
});
