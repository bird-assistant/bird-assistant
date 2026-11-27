import {photoInfo} from '../../services/photo-info';
import {cleanLocalMetadata} from '../../services/photo-metadata';
import {PHOTO_FIELDS,cleanPhotoDetails} from '../../services/photo-details';
Component({
  properties:{readonly:{type:Boolean,value:false},fileInfo:{type:Object,value:null},disabled:{type:Boolean,value:false},value:{type:Object,value:{}}},
  data:{open:false,fields:PHOTO_FIELDS,embedded:null as ReturnType<typeof photoInfo>,metadataMessage:''},
  observers:{fileInfo(value:unknown){const meta=cleanLocalMetadata(value);this.setData({embedded:meta?photoInfo(meta.camera,'从照片文件读取'):null,metadataMessage:!meta?'':meta.state==='unavailable'?'暂时无法读取文件参数，原图仍保留。':meta.state==='unsupported'?'暂未读取这种格式的相机参数。':meta.hasExif?'已读取照片文件中的参数。':'未读到相机参数，可保留未知。'});}},
  methods:{toggle(){this.setData({open:!this.data.open});},change(event:WechatMiniprogram.CustomEvent<{value:string}>){if(this.data.disabled||this.data.readonly)return;const key=String(event.currentTarget.dataset.key);if(!PHOTO_FIELDS.some(field=>field.key===key))return;this.triggerEvent('change',cleanPhotoDetails({...this.data.value,[key]:event.detail.value}));}}
});
