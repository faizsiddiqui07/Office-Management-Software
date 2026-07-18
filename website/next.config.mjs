/**
 * A stamp that changes on every deploy. Amplify exposes the commit it's building
 * (AWS_COMMIT_ID); locally there's no commit, so fall back to the start time.
 *
 * The running app carries the stamp it was built with, while /api/version reports the
 * one that's currently deployed. When those differ, a newer version is live and the app
 * can offer to reload — instead of trusting the browser to have noticed by itself.
 */
const buildId = process.env.AWS_COMMIT_ID || `dev-${Date.now()}`;

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  generateBuildId: () => buildId,
};

export default nextConfig;
