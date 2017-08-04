const path = require('path')

module.exports =
async function getExampleMediaStream () {
  const video = document.createElement('video')
  video.src = `file://${path.join(__dirname, 'test.mp4')}`
  await new Promise((resolve) => video.addEventListener('canplay', resolve))
  return video.captureStream()
}
