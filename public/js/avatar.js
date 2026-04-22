const KEY = 'avatar';
const FALLBACK = 'img/placeholder.png';

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
