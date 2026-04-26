/* global heic2any */
(function () {
  'use strict';

  const API_BASE = 'https://rwkz3d86u0.execute-api.us-east-1.amazonaws.com';
  const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif'];
  const MAX_SIZE = 10 * 1024 * 1024;
  const MIN_PHOTOS = 2;
  const MAX_PHOTOS = 3;

  let state = {
    leadId: null,
    isTest: false,
    photos: [],
    onComplete: null
  };

  function buildModal() {
    if (document.querySelector('.photo-modal')) return;

    const modal = document.createElement('div');
    modal.className = 'photo-modal';
    modal.innerHTML = `
      <div class="photo-modal__overlay" data-close></div>
      <div class="photo-modal__container">
        <button class="photo-modal__close" data-close>&times;</button>
        <h2 class="photo-modal__title">Add your photos</h2>
        <p class="photo-modal__subtitle">
          Please share 2 to 3 photos that represent you authentically. We suggest one clear photo of your face and one or two of you in your daily context. JPEG, PNG, or HEIC accepted (max 10MB each).
        </p>
        <div class="photo-modal__error" data-error style="display:none"></div>
        <div class="photo-modal__dropzone" data-dropzone>
          <input type="file" data-file-input accept="image/jpeg,image/png,image/heic,image/heif" multiple style="display:none">
          <div class="photo-modal__dropzone-text">
            Drag photos here or <strong>click to browse</strong>
          </div>
        </div>
        <div class="photo-modal__previews" data-previews></div>
        <button class="photo-modal__continue" data-continue disabled>
          Continue (need at least ${MIN_PHOTOS})
        </button>
      </div>
    `;

    document.body.appendChild(modal);

    const dropzone = modal.querySelector('[data-dropzone]');
    const fileInput = modal.querySelector('[data-file-input]');

    modal.querySelectorAll('[data-close]').forEach((el) => {
      el.addEventListener('click', close);
    });

    dropzone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('photo-modal__dropzone--dragging');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('photo-modal__dropzone--dragging');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('photo-modal__dropzone--dragging');
      handleFiles(e.dataTransfer.files);
    });

    modal.querySelector('[data-continue]').addEventListener('click', () => {
      const readyPhotos = state.photos.filter((photo) => photo.status === 'ready');
      if (readyPhotos.length >= MIN_PHOTOS && state.onComplete) {
        state.onComplete(readyPhotos.map((photo) => photo.photo_id));
        close();
      }
    });
  }

  function showError(msg) {
    const el = document.querySelector('[data-error]');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 5000);
  }

  async function loadHeic2any() {
    if (window.heic2any) return;

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function handleFiles(fileList) {
    const remaining = MAX_PHOTOS - state.photos.length;
    if (remaining <= 0) {
      showError(`Maximum ${MAX_PHOTOS} photos`);
      return;
    }

    const files = Array.from(fileList || []).slice(0, remaining);
    for (const file of files) {
      try {
        await processFile(file);
      } catch (err) {
        console.error('processFile error', err);
        showError(err.message || 'Upload failed');
      }
    }

    renderPreviews();
    updateContinueButton();
  }

  async function processFile(file) {
    if (!ACCEPTED_TYPES.includes(file.type) && !/\.(heic|heif|jpeg|jpg|png)$/i.test(file.name)) {
      throw new Error('Unsupported file type');
    }

    const isHeic = file.type === 'image/heic' || file.type === 'image/heif' ||
      /\.heic$/i.test(file.name) || /\.heif$/i.test(file.name);

    let processedFile = file;

    if (isHeic) {
      await loadHeic2any();
      const convertedBlob = await window.heic2any({
        blob: file,
        toType: 'image/jpeg',
        quality: 0.92
      });
      const outputBlob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
      processedFile = new File(
        [outputBlob],
        file.name.replace(/\.(heic|heif)$/i, '.jpg'),
        { type: 'image/jpeg' }
      );
    }

    if (processedFile.size > MAX_SIZE) {
      throw new Error(`File too large: ${(processedFile.size / 1024 / 1024).toFixed(1)}MB (max 10MB)`);
    }

    if (processedFile.type !== 'image/jpeg' && processedFile.type !== 'image/png') {
      throw new Error('Unsupported file type');
    }

    const previewUrl = URL.createObjectURL(processedFile);
    const photoEntry = {
      photo_id: null,
      file: processedFile,
      previewUrl,
      progress: 0,
      status: 'uploading',
      thumbnail_url: null
    };

    state.photos.push(photoEntry);
    renderPreviews();
    await uploadFile(photoEntry);
  }

  async function uploadFile(entry) {
    const initRes = await fetch(`${API_BASE}/photo-upload-init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead_id: state.leadId,
        content_type: entry.file.type,
        file_size: entry.file.size,
        is_test: state.isTest
      })
    });

    const initData = await initRes.json();
    if (!initRes.ok) {
      throw new Error(initData.error || 'Init failed');
    }

    entry.photo_id = initData.photo_id;
    renderPreviews();

    const formData = new FormData();
    Object.entries(initData.upload_fields).forEach(([key, value]) => formData.append(key, value));
    formData.append('file', entry.file);

    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', initData.upload_url);
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          entry.progress = Math.round((event.loaded / event.total) * 100);
          renderPreviews();
        }
      });
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Upload failed: ${xhr.status}`));
        }
      });
      xhr.addEventListener('error', () => reject(new Error('Upload network error')));
      xhr.send(formData);
    });

    entry.status = 'processing';
    renderPreviews();
    pollStatus(entry);
  }

  async function pollStatus(entry) {
    const maxAttempts = 30;

    for (let i = 0; i < maxAttempts; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));

      try {
        const res = await fetch(`${API_BASE}/photo-upload-status?lead_id=${encodeURIComponent(state.leadId)}&photo_id=${encodeURIComponent(entry.photo_id)}`);
        const data = await res.json();

        if (data.status === 'ready' && data.thumbnail_url) {
          entry.status = 'ready';
          entry.thumbnail_url = data.thumbnail_url;
          renderPreviews();
          updateContinueButton();
          return;
        }
      } catch (err) {
        console.warn('poll error', err);
      }
    }

    entry.status = 'timeout';
    renderPreviews();
  }

  function renderPreviews() {
    const container = document.querySelector('[data-previews]');
    if (!container) return;

    container.innerHTML = state.photos.map((photo, index) => `
      <div class="photo-modal__preview">
        <img src="${photo.thumbnail_url || photo.previewUrl}" alt="">
        <button class="photo-modal__preview-remove" data-remove="${index}">&times;</button>
        ${photo.status === 'uploading' ? `<div class="photo-modal__preview-progress" style="width:${photo.progress}%"></div>` : ''}
      </div>
    `).join('');

    container.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', (event) => {
        const index = parseInt(event.currentTarget.dataset.remove, 10);
        URL.revokeObjectURL(state.photos[index].previewUrl);
        state.photos.splice(index, 1);
        renderPreviews();
        updateContinueButton();
      });
    });
  }

  function updateContinueButton() {
    const btn = document.querySelector('[data-continue]');
    if (!btn) return;

    const readyCount = state.photos.filter((photo) => photo.status === 'ready').length;
    btn.disabled = readyCount < MIN_PHOTOS;
    btn.textContent = readyCount >= MIN_PHOTOS
      ? `Continue with ${readyCount} photo${readyCount > 1 ? 's' : ''}`
      : `Continue (need at least ${MIN_PHOTOS})`;
  }

  function open(opts) {
    state.isTest = opts.isTest || false;
    state.onComplete = opts.onComplete;

    if (state.leadId !== opts.leadId) {
      state.photos = [];
    }

    state.leadId = opts.leadId;

    buildModal();
    renderPreviews();
    updateContinueButton();
    document.querySelector('.photo-modal').classList.add('photo-modal--open');
  }

  function close() {
    const modal = document.querySelector('.photo-modal');
    if (modal) modal.classList.remove('photo-modal--open');
  }

  function getPhotoIds() {
    return state.photos.filter((photo) => photo.status === 'ready').map((photo) => photo.photo_id);
  }

  window.PhotoUploadModal = { open, close, getPhotoIds };
})();
