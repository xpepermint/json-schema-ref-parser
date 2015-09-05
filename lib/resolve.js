'use strict';

var Promise   = require('./promise'),
    read      = require('./read'),
    util      = require('./util'),
    url       = require('url'),
    ono       = require('ono'),
    _forEach  = require('lodash/collection/forEach'),
    _isArray  = require('lodash/lang/isArray'),
    _isObject = require('lodash/lang/isObject'),
    _isString = require('lodash/lang/isString');

module.exports = resolve;

/**
 * Crawls the JSON schema, finds all external JSON references, and resolves their values.
 * This method does not mutate the JSON schema. The resolved values are added to {@link $RefParser#$refs}.
 *
 * NOTE: We only care about EXTERNAL references here. INTERNAL references are only relevant when dereferencing.
 *
 * @param {$RefParser} parser
 * @param {ParserOptions} options
 *
 * @returns {Promise}
 * The promise resolves once all JSON references in the schema have been resolved,
 * including nested references that are contained in externally-referenced files.
 */
function resolve(parser, options) {
  try {
    if (!options.$refs.external) {
      // Nothing to resolve, so exit early
      return Promise.resolve();
    }

    util.debug('Resolving $ref pointers in %s', parser._basePath);
    var promises = crawl(parser.schema, parser._basePath + '#', parser, options);
    return Promise.all(promises);
  }
  catch (e) {
    return Promise.reject(e);
  }
}

/**
 * Recursively crawls the given value, and resolves any external JSON references.
 *
 * @param {*} obj - The value to crawl. If it's not an object or array, it will be ignored.
 * @param {string} path - The path to use for resolving relative JSON references.
 * @param {$RefParser} parser
 * @param {ParserOptions} options
 *
 * @returns {Promise[]}
 * Returns an array of promises. There will be one promise for each JSON reference in `obj`.
 * If `obj` does not contain any JSON references, then the array will be empty.
 * If any of the JSON references point to files that contain additional JSON references,
 * then the corresponding promise will internally reference an array of promises.
 */
function crawl(obj, path, parser, options) {
  var promises = [];

  if (_isObject(obj) || _isArray(obj)) {
    _forEach(obj, function(value, key) {
      var keyPath = path + '/' + key;

      if (isExternal$Ref(key, value)) {
        // We found a $ref
        util.debug('Resolving $ref pointer "%s" at %s', value, keyPath);
        var $refPath = url.resolve(path, value);

        // Crawl the $referenced value
        var promise = crawl$Ref($refPath, parser, options)
          .catch(function(err) {
            throw ono.syntax(err, 'Error at %s', keyPath);
          });
        promises.push(promise);
      }
      else {
        promises = promises.concat(crawl(value, keyPath, parser, options));
      }
    });
  }
  return promises;
}

/**
 * Reads the file/URL at the given path, and then crawls the resulting value and resolves
 * any external JSON references.
 *
 * @param {string} path - The file path or URL to crawl
 * @param {$RefParser} parser
 * @param {ParserOptions} options
 *
 * @returns {Promise}
 * The promise resolves once all JSON references in the object have been resolved,
 * including nested references that are contained in externally-referenced files.
 */
function crawl$Ref(path, parser, options) {
  return read(path, parser, options)
    .then(function($ref) {
      // If a cached $ref is returned, then we DON'T need to crawl it
      if (!$ref.cached) {
        // This is a new $ref, so we need to crawl it
        util.debug('Resolving $ref pointers in %s', $ref.path);
        var promises = crawl($ref.value, $ref.path + '#', parser, options);
        return Promise.all(promises);
      }
    });
}

/**
 * Determines whether the given key/value pair are an external JSON reference.
 *
 * @param {string} key - A key, such as an object property or array index.
 * @param {*} value - The value of the key. Must be a string to be a JSON reference.
 * @returns {boolean}
 */
function isExternal$Ref(key, value) {
  return key === '$ref' && value && _isString(value) && value[0] !== '#';
}