import {faultSummary} from './services/diagnostics';
declare const require:(path:string)=>{protectLocalCollections:()=>void};
App({
  onLaunch() {
    // Registration and service configuration are explicit. No location, login or cloud initialization here.
    setTimeout(()=>{try{require('./services/startup-protection').protectLocalCollections();}catch(error){faultSummary('local-data-protection',error);}},0);
    console.info('[Bird Assistant] native local checkpoint 0.4.21 · review');
  },
  onError(message){faultSummary('app-error',message);console.error('[Bird Assistant] uncaught',message);},
  onUnhandledRejection(event){faultSummary('unhandled-promise',event.reason);console.error('[Bird Assistant] unhandled rejection',event.reason);}
});
