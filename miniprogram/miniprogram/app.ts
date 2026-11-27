import {faultSummary} from './services/diagnostics';
App({
  onLaunch() {
    // Registration and service configuration are explicit. No location, login or cloud initialization here.
    console.info('[Bird Assistant] native local checkpoint 0.4.16 · review');
  },
  onError(message){faultSummary('app-error',message);console.error('[Bird Assistant] uncaught',message);},
  onUnhandledRejection(event){faultSummary('unhandled-promise',event.reason);console.error('[Bird Assistant] unhandled rejection',event.reason);}
});
