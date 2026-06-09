if (process.env.RENDER || process.env.CI || process.env.VERCEL) {
  require('child_process').execSync('npm run build', { stdio: 'inherit' })
}
