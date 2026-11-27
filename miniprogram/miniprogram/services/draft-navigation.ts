// One-shot handoffs carry only a local ID; original media stay in their existing stores.
let reviewId='',composeId='';
export function queueObservationReview(id:string){reviewId=id;}
export function takeObservationReview(){const id=reviewId;reviewId='';return id;}
export function queuePostDraft(id:string){composeId=id;}
export function takePostDraft(){const id=composeId;composeId='';return id;}
