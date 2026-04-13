const API_BASE = "https://rwkz3d86u0.execute-api.us-east-1.amazonaws.com";

const ENDPOINTS = {
  checkout: `${API_BASE}/gateway`,
  validate: `${API_BASE}/validate`,
  member: `${API_BASE}/member`
};

function getParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    lead_id: params.get("lead_id"),
    token: params.get("token")
  };
}

function startCheckout(product, plan = "", term = "") {
  const { lead_id, token } = getParams();

  if (!lead_id || !token) {
    alert("Missing lead_id or token");
    return;
  }

  let url = `${ENDPOINTS.checkout}?lead_id=${encodeURIComponent(lead_id)}&token=${encodeURIComponent(token)}&product=${encodeURIComponent(product)}`;

  if (plan) {
    url += `&plan=${encodeURIComponent(plan)}`;
  }

  if (term) {
    url += `&term=${encodeURIComponent(term)}`;
  }

  window.location.href = url;
}

function goFounder() {
  startCheckout("founder");
}

function goAccess() {
  startCheckout("access");
}

function goMembership() {
  startCheckout("membership", "mid", "monthly");
}

function handleSuccess() {
  const { lead_id, token } = getParams();

  if (lead_id && token) {
    localStorage.setItem("presttige_lead_id", lead_id);
    localStorage.setItem("presttige_token", token);

    setTimeout(() => {
      window.location.href = "/member.html";
    }, 1500);
  }
}

async function loadMember() {
  const token = localStorage.getItem("presttige_token");
  const lead_id = localStorage.getItem("presttige_lead_id");

  if (!token || !lead_id) {
    window.location.href = "/";
    return;
  }

  const res = await fetch(ENDPOINTS.validate, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ token, lead_id })
  });

  const data = await res.json();

  if (!data.valid) {
    window.location.href = "/";
    return;
  }

  document.body.innerHTML = `
    <h1>Member Area</h1>
    <p>Status: ${data.access_status || "-"}</p>
    <p>Product: ${data.product || "-"}</p>
    <p>Plan: ${data.plan || "-"}</p>
  `;
}