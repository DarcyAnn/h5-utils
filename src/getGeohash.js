/*
 * 获取用户地址 Geohash
 * 依赖：HybridAPI Geohash.js Promise 以及 fetch
 * 优先级：url?geohash=XXX > HybridAPI/AlipayJSAPI > Navigator > restAPI
 */
import resolveFetch from './resolveFetch.js'

const IS_IOS = /iPhone|iPad|iPod|iOS/i.test(navigator.userAgent)

const API_HOST = /opensite/.test(document.domain)
  ? location.origin.replace(/\:\/\/opensite([-|.][^.]+)/,"://opensite-restapi$1")
  : location.origin.replace(/(https?\:\/\/).*?((\.[a-z]*)?\.(ele|elenet){1}\.me)/, '$1restapi$2')

const request = url => window.fetch(url, { credentials: 'omit' }).then(resolveFetch)

const getParamHash = () => window.UParams ? (window.UParams().geohash || '') : ''

const getAppHash = (timeout = 5000, interval = 100) => {
  let intervalTimer = null

  const stop = () => {
    clearInterval(intervalTimer)
  }

  return new Promise((resolve, reject) => {
    if (!window.hybridAPI) {
      return reject()
    }

    let loop = () => {
      window.hybridAPI.getGlobalGeohash()
      .then(hash => {
        if (!hash) return
        stop()
        resolve(hash)
      })
    }

    intervalTimer = setInterval(loop, interval)
    loop()

    setTimeout(() => {
      stop()
      reject()
    }, timeout)
  })
}

const getNavigatorHash = (timeout = 5000) => {
  // Read more info: https://developer.mozilla.org/zh-CN/docs/Web/API/Geolocation/getCurrentPosition
  if (!navigator.geolocation) return Promise.reject()
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(position => {
      if (!position.coords.latitude) {
        reject({ name: 'BROWSER_MODE_PERMISSON_FAILED' })
      }
      resolve(window.Geohash.encode(position.coords.latitude, position.coords.longitude))
    }, reject, {
      timeout,
      maximumAge: 10000,
    })
  })
}

const getAPIHash = (timeout = 3000) => {
  const URL = `${API_HOST}/shopping/v1/cities/guess`
  const timer = new Promise((_, reject) => setTimeout(() => {
    reject({ name: 'API_GUESS_TIMEOUT' })
  }, timeout))

  return Promise.race([request(URL), timer])
  .then(({ latitude, longitude }) => window.Geohash.encode(latitude, longitude))
}

const getAlipayHash = () => {
  // 依赖alipay-jssdk
  if (!window.ap) return Promise.reject()
  // getCurrentLocation since 10.0.18
  const isOldVersion = ap.compareVersion('10.0.18') < 0
  const timeout = 10
  const cacheTimeout = 1800 // 使用30min的缓存
  const task = isOldVersion ?
    ap.getLocation({ timeout, cacheTimeout }) :
    ap.call('getCurrentLocation', {
      timeout,
      cacheTimeout,
      requestType: 0,
      bizType: IS_IOS ? 'iOS-ele-position' : 'Android-ele-position',
    })

  return task.then(res => window.Geohash.encode(res.latitude, res.longitude))
}

const browserMode = (timeout) => {
  // 通过原生 API 获取失败后,看下有没有 apiHash 没有的话直接 reject()
  return new Promise((resolve, reject) => {
    getNavigatorHash(timeout)
    .then(resolve)
    .catch(() => getAPIHash())
    .then(resolve)
    .catch(reject)
  })
}

const appMode = (timeout, browserModeDisabled) => {
  return getAppHash(timeout * 2 / 3)
    .catch(() => browserModeDisabled ? Promise.reject() : browserMode(timeout * 1 / 3))
}

const alipayMode = () => getAlipayHash().catch(() => getAPIHash())

const getGeohash = (timeout = 9000, browserModeDisabled = true) => {
  // 优先使用 URL 中传来的 geohash 参数
  let hash = getParamHash()
  if (hash) {
    return Promise.resolve(hash)
  }

  let source
  if (/Eleme/i.test(navigator.userAgent)) {
    source = appMode(timeout, browserModeDisabled)
  } else if (/AlipayClient/.test(navigator.userAgent)) {
    source = alipayMode()
  } else {
    source = browserMode(timeout)
  }

  return source
}

getGeohash.getParamHash = getParamHash
getGeohash.useApp = getAppHash
getGeohash.useGeoAPI = getNavigatorHash
getGeohash.useRestAPI = getAPIHash
getGeohash.useAlipay = getAlipayHash

export default getGeohash
