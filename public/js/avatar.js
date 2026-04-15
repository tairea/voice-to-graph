const KEY = 'avatar';

const FALLBACK = 'data:image/svg+xml;utf8,' + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <radialGradient id="g" cx="50%" cy="40%" r="60%">
      <stop offset="0%" stop-color="#6f86ff"/>
      <stop offset="100%" stop-color="#1a2150"/>
    </radialGradient>
  </defs>
  <circle cx="64" cy="64" r="64" fill="url(#g)"/>
  <circle cx="64" cy="52" r="20" fill="#e8ecf3"/>
  <path d="M24 112 C24 84 104 84 104 112 Z" fill="#e8ecf3"/>
</svg>
`);

export function getAvatar() {
  try {
    return localStorage.getItem(KEY) || FALLBACK;
  } catch {
    return FALLBACK;
  }
}

export function setAvatarFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      try { localStorage.setItem(KEY, dataUrl); } catch {}
      window.dispatchEvent(new CustomEvent('avatar-changed', { detail: dataUrl }));
      resolve(dataUrl);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
