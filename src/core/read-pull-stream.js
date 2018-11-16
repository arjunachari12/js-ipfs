'use strict'

const exporter = require('ipfs-unixfs-engine').exporter
const pull = require('pull-stream/pull')
const once = require('pull-stream/sources/once')
const asyncMap = require('pull-stream/throughs/async-map')
const defer = require('pull-defer')
const collect = require('pull-stream/sinks/collect')
const UnixFs = require('ipfs-unixfs')
const {
  traverseTo,
  createLock
} = require('./utils')
const log = require('debug')('ipfs:mfs:read-pull-stream')

const defaultOptions = {
  offset: 0,
  length: undefined
}

module.exports = (context) => {
  return function mfsReadPullStream (path, options = {}) {
    options = Object.assign({}, defaultOptions, options)

    // support legacy go arguments
    options.length = options.length || options.count

    log(`Reading ${path}`)

    const deferred = defer.source()

    pull(
      once(path),
      asyncMap((path, cb) => {
        createLock().readLock((next) => {
          traverseTo(context, path, {
            parents: false
          }, next)
        })(cb)
      }),
      asyncMap(({ node, cid }, cb) => {
        const meta = UnixFs.unmarshal(node.data)

        if (meta.type !== 'file') {
          return cb(new Error(`${path} was not a file`))
        }

        log(`Getting ${path} content`)

        pull(
          exporter(cid, context.ipld, {
            offset: options.offset,
            length: options.length
          }),
          collect((error, files) => {
            cb(error, error ? null : files[0].content)
          })
        )
      }),
      collect((error, streams) => {
        if (error) {
          return deferred.abort(error)
        }

        if (!streams.length) {
          return deferred.abort(new Error(`Could not load content stream from ${path}`))
        }

        log(`Got ${path} content`)
        deferred.resolve(streams[0])
      })
    )

    return deferred
  }
}
