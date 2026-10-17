const form = document.querySelector('#builder');
const inputs = document.querySelector('#inputs');
const build = document.querySelector('#build');
const cancel = document.querySelector('#cancel');
const panel = document.querySelector('#status-panel');
const status = document.querySelector('#status');
const activity = document.querySelector('#activity');
const download = document.querySelector('#download');
let worker;
let outputURL;

function message(text, error = false) {
  panel.hidden = false;
  panel.classList.toggle('error', error);
  status.textContent = text;
}

function finish() {
  worker?.terminate();
  worker = undefined;
  inputs.disabled = false;
  build.disabled = false;
  cancel.hidden = true;
  activity.hidden = true;
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (worker || !form.reportValidity()) return;
  if (!globalThis.crypto?.subtle || !globalThis.Worker) { message('Open this page over HTTPS in a modern browser.', true); return; }
  if (outputURL) URL.revokeObjectURL(outputURL);
  download.hidden = true;
  inputs.disabled = true;
  build.disabled = true;
  cancel.hidden = false;
  activity.hidden = false;
  message('Preparing your local workspace…');
  worker = new Worker(new URL('./signer.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') message(data.message);
    else if (data.type === 'done') {
      outputURL = URL.createObjectURL(data.blob);
      download.href = outputURL;
      download.hidden = false;
      message('Your signed IPA is ready.');
      finish();
      download.focus();
    } else { message(data.message, true); finish(); }
  };
  worker.onerror = () => { message('Processing stopped. Reload or try a desktop browser with more free memory.', true); finish(); };
  worker.postMessage({
    ipa: form.elements.ipa.files[0],
    certificate: form.elements.certificate.files[0],
    password: form.elements.password.value,
    provisionFiles: [...form.elements.profiles.files],
    appGroup: form.elements.appGroup.value.trim(),
    base: new URL('./', document.baseURI).href,
  });
  form.elements.password.value = '';
});

cancel.addEventListener('click', () => { finish(); message('Canceled. No IPA was generated.'); });
window.addEventListener('pagehide', () => { worker?.terminate(); if (outputURL) URL.revokeObjectURL(outputURL); });
