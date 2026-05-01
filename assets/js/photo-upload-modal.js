/* global heic2any */
(function () {
  "use strict";

  const API_BASE = "https://rwkz3d86u0.execute-api.us-east-1.amazonaws.com";
  const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/heic", "image/heif"];
  const MAX_SIZE = 10 * 1024 * 1024;
  const MIN_PHOTOS = 2;
  const MAX_PHOTOS = 3;

  let state = {
    leadId: null,
    isTest: false,
    photos: [],
    onChange: null,
    isCompleting: false,
  };

  function buildInlineStage() {
    const host = document.querySelector("[data-photo-upload-stage]");
    if (!host || host.querySelector(".photo-upload-inline")) return host;

    host.innerHTML = `
      <div class="photo-upload-inline">
        <div class="photo-upload-inline__error" data-error></div>
        <div class="photo-upload-inline__dropzone" data-dropzone>
          <input type="file" data-file-input accept="image/jpeg,image/png,image/heic,image/heif" multiple hidden>
          <div>
            <p class="photo-upload-inline__dropzone-copy">Drag photos here or click to browse</p>
            <p class="photo-upload-inline__helper">JPEG, PNG, or HEIC accepted. Up to 10MB each. Two to three photos recommended.</p>
          </div>
        </div>
        <div class="photo-upload-inline__previews" data-previews></div>
        <div class="photo-upload-inline__actions">
          <p class="photo-upload-inline__count" data-photo-count>Choose at least two photos.</p>
        </div>
      </div>
    `;

    const dropzone = host.querySelector("[data-dropzone]");
    const fileInput = host.querySelector("[data-file-input]");

    dropzone.addEventListener("click", () => {
      if (!state.isCompleting) fileInput.click();
    });

    fileInput.addEventListener("change", (event) => {
      handleFiles(event.target.files);
      event.target.value = "";
    });

    dropzone.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (!state.isCompleting) {
        dropzone.classList.add("photo-upload-inline__dropzone--dragging");
      }
    });

    dropzone.addEventListener("dragleave", () => {
      dropzone.classList.remove("photo-upload-inline__dropzone--dragging");
    });

    dropzone.addEventListener("drop", (event) => {
      event.preventDefault();
      dropzone.classList.remove("photo-upload-inline__dropzone--dragging");
      if (!state.isCompleting) handleFiles(event.dataTransfer.files);
    });

    return host;
  }

  function notifyChange() {
    updatePhotoCount();

    if (typeof state.onChange === "function") {
      state.onChange({
        count: state.photos.length,
        min: MIN_PHOTOS,
        max: MAX_PHOTOS,
      });
    }
  }

  function showError(message) {
    const error = document.querySelector("[data-error]");
    if (!error) return;
    error.textContent = message;
    error.style.display = "block";
    window.clearTimeout(showError._timer);
    showError._timer = window.setTimeout(() => {
      error.style.display = "none";
    }, 5000);
  }

  async function loadHeic2any() {
    if (window.heic2any) return;

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js";
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
      } catch (error) {
        console.error("processFile error", error);
        showError(error.message || "Could not add photo");
      }
    }

    renderPreviews();
    notifyChange();
  }

  async function processFile(file) {
    if (!ACCEPTED_TYPES.includes(file.type) && !/\.(heic|heif|jpeg|jpg|png)$/i.test(file.name)) {
      throw new Error("Unsupported file type");
    }

    if (hasDuplicateFileSignature(file.name, file.size)) {
      throw new Error("This file is already added. Please choose a different photo.");
    }

    const isHeic =
      file.type === "image/heic" ||
      file.type === "image/heif" ||
      /\.heic$/i.test(file.name) ||
      /\.heif$/i.test(file.name);

    let processedFile = file;

    if (isHeic) {
      await loadHeic2any();
      const convertedBlob = await window.heic2any({
        blob: file,
        toType: "image/jpeg",
        quality: 0.92,
      });
      const outputBlob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
      processedFile = new File([outputBlob], file.name.replace(/\.(heic|heif)$/i, ".jpg"), {
        type: "image/jpeg",
      });
    }

    if (processedFile.size > MAX_SIZE) {
      throw new Error(`File too large: ${(processedFile.size / 1024 / 1024).toFixed(1)}MB (max 10MB)`);
    }

    if (processedFile.type !== "image/jpeg" && processedFile.type !== "image/png") {
      throw new Error("Unsupported file type");
    }

    const contentHash = await hashFile(processedFile);
    if (contentHash && hasDuplicateContentHash(contentHash)) {
      throw new Error("This file is already added. Please choose a different photo.");
    }

    const previewUrl = URL.createObjectURL(processedFile);
    state.photos.push({
      photo_id: null,
      file: processedFile,
      originalName: file.name,
      originalSize: file.size,
      contentHash,
      previewUrl,
      progress: 0,
      status: "selected",
      thumbnail_url: null,
    });

    renderPreviews();
    notifyChange();
  }

  async function hashFile(file) {
    if (!window.crypto || !window.crypto.subtle || typeof file.arrayBuffer !== "function") {
      return "";
    }

    const buffer = await file.arrayBuffer();
    const digest = await window.crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  function hasDuplicateFileSignature(name, size) {
    const normalizedName = String(name || "").trim().toLowerCase();
    return state.photos.some((photo) => {
      const existingName = String(photo.originalName || photo.file?.name || "").trim().toLowerCase();
      const existingSize = Number(photo.originalSize || photo.file?.size || 0);
      return normalizedName && normalizedName === existingName && Number(size || 0) === existingSize;
    });
  }

  function hasDuplicateContentHash(hash) {
    return Boolean(hash) && state.photos.some((photo) => photo.contentHash === hash);
  }

  async function uploadFile(entry) {
    if (entry.status === "ready" && entry.photo_id) return entry.photo_id;

    if (!state.leadId) {
      throw new Error("Missing application reference for photo upload.");
    }

    entry.status = "uploading";
    entry.progress = 0;
    renderPreviews();
    notifyChange();

    const initRes = await fetch(`${API_BASE}/photo-upload-init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lead_id: state.leadId,
        content_type: entry.file.type,
        file_size: entry.file.size,
        is_test: state.isTest,
      }),
    });

    const initData = await initRes.json();
    if (!initRes.ok) {
      throw new Error(initData.error || "Init failed");
    }

    entry.photo_id = initData.photo_id;
    renderPreviews();

    const formData = new FormData();
    Object.entries(initData.upload_fields).forEach(([key, value]) => formData.append(key, value));
    formData.append("file", entry.file);

    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", initData.upload_url);
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          entry.progress = Math.round((event.loaded / event.total) * 100);
          renderPreviews();
        }
      });
      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Upload failed: ${xhr.status}`));
        }
      });
      xhr.addEventListener("error", () => reject(new Error("Upload network error")));
      xhr.send(formData);
    });

    entry.status = "processing";
    renderPreviews();
    notifyChange();

    return pollStatus(entry);
  }

  async function pollStatus(entry) {
    const maxAttempts = 30;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));

      try {
        const response = await fetch(
          `${API_BASE}/photo-upload-status?lead_id=${encodeURIComponent(state.leadId)}&photo_id=${encodeURIComponent(entry.photo_id)}`
        );
        const data = await response.json();

        if (data.status === "ready" && data.thumbnail_url) {
          entry.status = "ready";
          entry.thumbnail_url = data.thumbnail_url;
          renderPreviews();
          notifyChange();
          return data.photo_id || entry.photo_id;
        }
      } catch (error) {
        console.warn("poll error", error);
      }
    }

    entry.status = "timeout";
    renderPreviews();
    notifyChange();
    throw new Error("Photo processing timed out. Please try again.");
  }

  function renderPreviews() {
    const container = document.querySelector("[data-previews]");
    if (!container) return;

    container.innerHTML = state.photos
      .map((photo, index) => {
        const statusLabel =
          photo.status === "selected"
            ? "Selected"
            : photo.status === "ready"
              ? "Ready"
              : photo.status === "processing"
                ? "Processing"
                : photo.status === "timeout"
                  ? "Retry needed"
                  : "";

        return `
          <div class="photo-upload-inline__preview">
            <img src="${photo.thumbnail_url || photo.previewUrl}" alt="">
            <button class="photo-upload-inline__preview-remove" type="button" data-remove="${index}" ${state.isCompleting ? "disabled" : ""}>&times;</button>
            ${photo.status === "uploading" ? `<div class="photo-upload-inline__preview-progress" style="width:${photo.progress}%"></div>` : ""}
            ${statusLabel ? `<div class="photo-upload-inline__preview-status">${statusLabel}</div>` : ""}
          </div>
        `;
      })
      .join("");

    container.querySelectorAll("[data-remove]").forEach((button) => {
      button.addEventListener("click", (event) => {
        if (state.isCompleting) return;

        const index = parseInt(event.currentTarget.dataset.remove, 10);
        const removedPhoto = state.photos[index];
        if (removedPhoto?.previewUrl) {
          URL.revokeObjectURL(removedPhoto.previewUrl);
        }
        state.photos.splice(index, 1);
        renderPreviews();
        notifyChange();
      });
    });
  }

  function updatePhotoCount() {
    const count = document.querySelector("[data-photo-count]");
    if (!count) return;

    const selectedCount = state.photos.length;
    if (state.isCompleting) {
      count.textContent = "Uploading selected photos. Please keep this page open.";
      return;
    }

    count.textContent =
      selectedCount >= MIN_PHOTOS
        ? `${selectedCount} photo${selectedCount > 1 ? "s" : ""} selected.`
        : `Choose at least ${MIN_PHOTOS} photos. ${selectedCount} selected.`;
  }

  async function uploadSelectedPhotos() {
    if (state.isCompleting) {
      throw new Error("Photo upload is already in progress.");
    }

    if (state.photos.length < MIN_PHOTOS) {
      throw new Error(`Please add at least ${MIN_PHOTOS} photos.`);
    }

    if (state.photos.length > MAX_PHOTOS) {
      throw new Error(`Please keep your selection to ${MAX_PHOTOS} photos.`);
    }

    state.isCompleting = true;
    notifyChange();

    try {
      const photoIds = [];
      const selectedPhotos = state.photos.slice();
      for (const photo of selectedPhotos) {
        photoIds.push(await uploadFile(photo));
      }
      return photoIds;
    } catch (error) {
      showError(error.message || "Could not upload photos. Please try again.");
      throw error;
    } finally {
      state.isCompleting = false;
      notifyChange();
    }
  }

  function open(options) {
    state.isTest = Boolean(options.isTest);
    state.onChange = options.onChange || null;
    state.isCompleting = false;

    if (state.leadId !== options.leadId) {
      state.photos.forEach((photo) => {
        if (photo.previewUrl) URL.revokeObjectURL(photo.previewUrl);
      });
      state.photos = [];
    }

    state.leadId = options.leadId;
    buildInlineStage();
    renderPreviews();
    notifyChange();
  }

  function close() {
    state.photos.forEach((photo) => {
      if (photo.previewUrl) URL.revokeObjectURL(photo.previewUrl);
    });
    state.photos = [];
    renderPreviews();
    notifyChange();
  }

  function getPhotoIds() {
    return state.photos.filter((photo) => photo.status === "ready").map((photo) => photo.photo_id);
  }

  function getPhotoCount() {
    return state.photos.length;
  }

  window.PhotoUploadModal = {
    open,
    close,
    getPhotoIds,
    getPhotoCount,
    uploadSelectedPhotos,
  };
})();
