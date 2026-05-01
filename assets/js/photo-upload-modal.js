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
    onComplete: null,
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
            <p class="photo-upload-inline__helper">JPEG, PNG, or HEIC accepted. Please upload two to three images, up to 10MB each.</p>
          </div>
        </div>
        <div class="photo-upload-inline__previews" data-previews></div>
        <div class="photo-upload-inline__actions">
          <button class="photo-upload-inline__continue" data-continue disabled>Continue (need at least 2)</button>
        </div>
      </div>
    `;

    const dropzone = host.querySelector("[data-dropzone]");
    const fileInput = host.querySelector("[data-file-input]");

    dropzone.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (event) => {
      handleFiles(event.target.files);
      event.target.value = "";
    });

    dropzone.addEventListener("dragover", (event) => {
      event.preventDefault();
      dropzone.classList.add("photo-upload-inline__dropzone--dragging");
    });

    dropzone.addEventListener("dragleave", () => {
      dropzone.classList.remove("photo-upload-inline__dropzone--dragging");
    });

    dropzone.addEventListener("drop", (event) => {
      event.preventDefault();
      dropzone.classList.remove("photo-upload-inline__dropzone--dragging");
      handleFiles(event.dataTransfer.files);
    });

    host.querySelector("[data-continue]").addEventListener("click", () => {
      const readyPhotos = state.photos.filter((photo) => photo.status === "ready");
      if (readyPhotos.length >= MIN_PHOTOS && typeof state.onComplete === "function") {
        state.onComplete(readyPhotos.map((photo) => photo.photo_id));
      }
    });

    return host;
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
        showError(error.message || "Upload failed");
      }
    }

    renderPreviews();
    updateContinueButton();
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
    const photoEntry = {
      photo_id: null,
      file: processedFile,
      originalName: file.name,
      originalSize: file.size,
      contentHash,
      previewUrl,
      progress: 0,
      status: "uploading",
      thumbnail_url: null,
    };

    state.photos.push(photoEntry);
    renderPreviews();
    updateContinueButton();
    await uploadFile(photoEntry);
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
    updateContinueButton();
    pollStatus(entry);
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
          updateContinueButton();
          return;
        }
      } catch (error) {
        console.warn("poll error", error);
      }
    }

    entry.status = "timeout";
    renderPreviews();
    updateContinueButton();
  }

  function renderPreviews() {
    const container = document.querySelector("[data-previews]");
    if (!container) return;

    container.innerHTML = state.photos
      .map((photo, index) => {
        const statusLabel = photo.status === "ready" ? "Ready" : photo.status === "processing" ? "Processing" : photo.status === "timeout" ? "Retry needed" : "";
        return `
          <div class="photo-upload-inline__preview">
            <img src="${photo.thumbnail_url || photo.previewUrl}" alt="">
            <button class="photo-upload-inline__preview-remove" type="button" data-remove="${index}">&times;</button>
            ${photo.status === "uploading" ? `<div class="photo-upload-inline__preview-progress" style="width:${photo.progress}%"></div>` : ""}
            ${statusLabel ? `<div class="photo-upload-inline__preview-status">${statusLabel}</div>` : ""}
          </div>
        `;
      })
      .join("");

    container.querySelectorAll("[data-remove]").forEach((button) => {
      button.addEventListener("click", (event) => {
        const index = parseInt(event.currentTarget.dataset.remove, 10);
        if (state.photos[index]?.previewUrl) {
          URL.revokeObjectURL(state.photos[index].previewUrl);
        }
        state.photos.splice(index, 1);
        renderPreviews();
        updateContinueButton();
      });
    });
  }

  function updateContinueButton() {
    const button = document.querySelector("[data-continue]");
    if (!button) return;

    const readyCount = state.photos.filter((photo) => photo.status === "ready").length;
    button.disabled = readyCount < MIN_PHOTOS;
    button.textContent =
      readyCount >= MIN_PHOTOS
        ? `Continue with ${readyCount} photo${readyCount > 1 ? "s" : ""}`
        : `Continue (need at least ${MIN_PHOTOS})`;
  }

  function open(options) {
    state.isTest = Boolean(options.isTest);
    state.onComplete = options.onComplete;

    if (state.leadId !== options.leadId) {
      state.photos.forEach((photo) => {
        if (photo.previewUrl) URL.revokeObjectURL(photo.previewUrl);
      });
      state.photos = [];
    }

    state.leadId = options.leadId;
    buildInlineStage();
    renderPreviews();
    updateContinueButton();

    const stage = document.getElementById("photoUploadStage");
    if (stage) {
      stage.classList.add("is-visible");
      stage.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function close() {
    const stage = document.getElementById("photoUploadStage");
    if (stage) {
      stage.classList.remove("is-visible");
    }
  }

  function getPhotoIds() {
    return state.photos.filter((photo) => photo.status === "ready").map((photo) => photo.photo_id);
  }

  window.PhotoUploadModal = { open, close, getPhotoIds };
})();
