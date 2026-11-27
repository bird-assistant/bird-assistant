import {PHOTO_FIELDS,cleanPhotoDetails} from '../../services/photo-details';
Component({
  properties:{value:{type:Object,value:{}}},
  data:{open:false,fields:PHOTO_FIELDS},
  methods:{toggle(){this.setData({open:!this.data.open});},change(event:WechatMiniprogram.CustomEvent<{value:string}>){const key=String(event.currentTarget.dataset.key);if(!PHOTO_FIELDS.some(field=>field.key===key))return;this.triggerEvent('change',cleanPhotoDetails({...this.data.value,[key]:event.detail.value}));}}
});
