// Points the main button at the right download for this device.
(function () {
  const ua = navigator.userAgent
  const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || ''
  let os = 'web'
  if (/Android/i.test(ua)) os = 'android'
  else if (/iPhone|iPad|iPod/.test(ua) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1)) os = 'ios'
  else if (/Win/i.test(platform) || /Windows/.test(ua)) os = 'windows'
  else if (/Mac/i.test(platform)) os = 'mac'
  else if (/CrOS/.test(ua)) os = 'web'
  else if (/Linux|X11/i.test(platform + ua)) os = 'linux'

  const names = { windows: 'Windows', mac: 'Mac', linux: 'Linux', android: 'Android' }
  const card = document.querySelector('.dl-card[data-os="' + os + '"]')
  const cta = document.getElementById('cta')
  if (card) card.classList.add('mine')
  if (card && names[os]) {
    cta.href = card.querySelector('.btn').href
    cta.textContent = 'Download for ' + names[os]
  }

  // The cover image has its own play button; a click anywhere on it starts the video.
  const video = document.getElementById('demo-video')
  const play = document.querySelector('.player .play')
  if (video && play) {
    play.addEventListener('click', () => video.play())
    video.addEventListener('play', () => video.closest('.player').classList.add('playing'))
  }
})()
