"use strict";

function normalizeReviewStatus(value) {
  return String(value ?? "").trim().toLowerCase();
}

function getBackfillResendIneligibilityReason(record) {
  const reviewStatus = normalizeReviewStatus(record?.review_status);
  if (!reviewStatus || reviewStatus === "pending") {
    return null;
  }

  return `review_status_${reviewStatus}`;
}

function isEligibleForBackfillResend(record) {
  return getBackfillResendIneligibilityReason(record) === null;
}

module.exports = {
  normalizeReviewStatus,
  getBackfillResendIneligibilityReason,
  isEligibleForBackfillResend,
};
