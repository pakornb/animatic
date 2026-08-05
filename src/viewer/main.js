import '../style.css';

// Step 1 placeholder. The read-only player (proportional timeline, transport,
// audio with slip) is built in step 4 and consumes the viewer JSON exported by
// the editor. For now this just confirms the second entry builds and routes.
const $ = (id) => document.getElementById(id);

$('pickBtn').onclick = () => $('fileInput').click();
$('fileInput').onchange = (e) => {
  const f = e.target.files[0];
  if (f) $('msg').textContent = `Loaded ${f.name} — playback UI arrives in step 4.`;
};

const params = new URLSearchParams(location.search);
if (params.get('src')) {
  $('msg').textContent = 'Remote viewer JSON support arrives in step 4.';
}
