/*eslint-disable block-scoped-var, id-length, no-control-regex, no-magic-numbers, no-mixed-operators, no-prototype-builtins, no-redeclare, no-shadow, no-var, sort-vars, default-case, jsdoc/require-param*/
"use strict";

var $protobuf = require("protobufjs/minimal");

// Common aliases
var $Reader = $protobuf.Reader, $Writer = $protobuf.Writer, $util = $protobuf.util;

// Exported root namespace
var $root = $protobuf.roots["default"] || ($protobuf.roots["default"] = {});

$root.languagecheck = (function() {

    /**
     * Namespace languagecheck.
     * @exports languagecheck
     * @namespace
     */
    var languagecheck = {};

    languagecheck.Request = (function() {

        /**
         * Properties of a Request.
         * @typedef {Object} languagecheck.Request.$Properties
         * @property {number|Long|null} [id] Request id
         * @property {languagecheck.CheckRequest.$Properties|null} [checkProse] Request checkProse
         * @property {languagecheck.MetadataRequest.$Properties|null} [getMetadata] Request getMetadata
         * @property {languagecheck.IgnoreRequest.$Properties|null} [ignore] Request ignore
         * @property {languagecheck.InitializeRequest.$Properties|null} [initialize] Request initialize
         * @property {languagecheck.AddDictionaryWordRequest.$Properties|null} [addDictionaryWord] Request addDictionaryWord
         * @property {"checkProse"|"getMetadata"|"ignore"|"initialize"|"addDictionaryWord"} [payload] Request payload
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding
         */

        /**
         * Properties of a Request.
         * @memberof languagecheck
         * @interface IRequest
         * @augments languagecheck.Request.$Properties
         * @deprecated Use languagecheck.Request.$Properties instead.
         */

        /**
         * Narrowed shape of a Request.
         * @typedef {{
         *   id?: number|Long|null;
         *   checkProse?: languagecheck.CheckRequest.$Shape|null;
         *   getMetadata?: languagecheck.MetadataRequest.$Shape|null;
         *   ignore?: languagecheck.IgnoreRequest.$Shape|null;
         *   initialize?: languagecheck.InitializeRequest.$Shape|null;
         *   addDictionaryWord?: languagecheck.AddDictionaryWordRequest.$Shape|null;
         *   $unknowns?: Array.<Uint8Array>;
         * } & (
         *   ({ payload?: undefined; checkProse?: null; getMetadata?: null; ignore?: null; initialize?: null; addDictionaryWord?: null }|{ payload?: "checkProse"; checkProse: languagecheck.CheckRequest.$Shape; getMetadata?: null; ignore?: null; initialize?: null; addDictionaryWord?: null }|{ payload?: "getMetadata"; checkProse?: null; getMetadata: languagecheck.MetadataRequest.$Shape; ignore?: null; initialize?: null; addDictionaryWord?: null }|{ payload?: "ignore"; checkProse?: null; getMetadata?: null; ignore: languagecheck.IgnoreRequest.$Shape; initialize?: null; addDictionaryWord?: null }|{ payload?: "initialize"; checkProse?: null; getMetadata?: null; ignore?: null; initialize: languagecheck.InitializeRequest.$Shape; addDictionaryWord?: null }|{ payload?: "addDictionaryWord"; checkProse?: null; getMetadata?: null; ignore?: null; initialize?: null; addDictionaryWord: languagecheck.AddDictionaryWordRequest.$Shape })
         * )} languagecheck.Request.$Shape
         */

        /**
         * Constructs a new Request.
         * @memberof languagecheck
         * @classdesc Represents a Request.
         * @constructor
         * @param {languagecheck.Request.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding
         */
        function Request(properties) {
            if (properties)
                for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * Request id.
         * @member {number|Long} id
         * @memberof languagecheck.Request
         * @instance
         */
        Request.prototype.id = $util.Long ? $util.Long.fromBits(0,0,true) : 0;

        /**
         * Request checkProse.
         * @member {languagecheck.CheckRequest.$Properties|null|undefined} checkProse
         * @memberof languagecheck.Request
         * @instance
         */
        Request.prototype.checkProse = null;

        /**
         * Request getMetadata.
         * @member {languagecheck.MetadataRequest.$Properties|null|undefined} getMetadata
         * @memberof languagecheck.Request
         * @instance
         */
        Request.prototype.getMetadata = null;

        /**
         * Request ignore.
         * @member {languagecheck.IgnoreRequest.$Properties|null|undefined} ignore
         * @memberof languagecheck.Request
         * @instance
         */
        Request.prototype.ignore = null;

        /**
         * Request initialize.
         * @member {languagecheck.InitializeRequest.$Properties|null|undefined} initialize
         * @memberof languagecheck.Request
         * @instance
         */
        Request.prototype.initialize = null;

        /**
         * Request addDictionaryWord.
         * @member {languagecheck.AddDictionaryWordRequest.$Properties|null|undefined} addDictionaryWord
         * @memberof languagecheck.Request
         * @instance
         */
        Request.prototype.addDictionaryWord = null;

        // OneOf field names bound to virtual getters and setters
        var $oneOfFields;

        /**
         * Request payload.
         * @member {"checkProse"|"getMetadata"|"ignore"|"initialize"|"addDictionaryWord"|undefined} payload
         * @memberof languagecheck.Request
         * @instance
         */
        Object.defineProperty(Request.prototype, "payload", {
            get: $util.oneOfGetter($oneOfFields = ["checkProse", "getMetadata", "ignore", "initialize", "addDictionaryWord"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        /**
         * Creates a new Request instance using the specified properties.
         * @function create
         * @memberof languagecheck.Request
         * @static
         * @param {languagecheck.Request.$Properties=} [properties] Properties to set
         * @returns {languagecheck.Request} Request instance
         * @type {{
         *   (properties: languagecheck.Request.$Shape): languagecheck.Request & languagecheck.Request.$Shape;
         *   (properties?: languagecheck.Request.$Properties): languagecheck.Request;
         * }}
         */
        Request.create = function create(properties) {
            return new Request(properties);
        };

        /**
         * Encodes the specified Request message. Does not implicitly {@link languagecheck.Request.verify|verify} messages.
         * @function encode
         * @memberof languagecheck.Request
         * @static
         * @param {languagecheck.Request.$Properties} message Request message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Request.encode = function encode(message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            if (message.id != null && Object.hasOwnProperty.call(message, "id"))
                writer.uint32(/* id 1, wireType 0 =*/8).uint64(message.id);
            if (message.checkProse != null && Object.hasOwnProperty.call(message, "checkProse"))
                $root.languagecheck.CheckRequest.encode(message.checkProse, writer.uint32(/* id 2, wireType 2 =*/18).fork(), _depth + 1).ldelim();
            if (message.getMetadata != null && Object.hasOwnProperty.call(message, "getMetadata"))
                $root.languagecheck.MetadataRequest.encode(message.getMetadata, writer.uint32(/* id 3, wireType 2 =*/26).fork(), _depth + 1).ldelim();
            if (message.ignore != null && Object.hasOwnProperty.call(message, "ignore"))
                $root.languagecheck.IgnoreRequest.encode(message.ignore, writer.uint32(/* id 4, wireType 2 =*/34).fork(), _depth + 1).ldelim();
            if (message.initialize != null && Object.hasOwnProperty.call(message, "initialize"))
                $root.languagecheck.InitializeRequest.encode(message.initialize, writer.uint32(/* id 5, wireType 2 =*/42).fork(), _depth + 1).ldelim();
            if (message.addDictionaryWord != null && Object.hasOwnProperty.call(message, "addDictionaryWord"))
                $root.languagecheck.AddDictionaryWordRequest.encode(message.addDictionaryWord, writer.uint32(/* id 6, wireType 2 =*/50).fork(), _depth + 1).ldelim();
            if (message.$unknowns != null && Object.hasOwnProperty.call(message, "$unknowns"))
                for (var i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Encodes the specified Request message, length delimited. Does not implicitly {@link languagecheck.Request.verify|verify} messages.
         * @function encodeDelimited
         * @memberof languagecheck.Request
         * @static
         * @param {languagecheck.Request.$Properties} message Request message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Request.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer && writer.len ? writer.fork() : writer).ldelim();
        };

        /**
         * Decodes a Request message from the specified reader or buffer.
         * @function decode
         * @memberof languagecheck.Request
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {languagecheck.Request & languagecheck.Request.$Shape} Request
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        Request.decode = function decode(reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw Error("max depth exceeded");
            var end = length === undefined ? reader.len : reader.pos + length, message = _target || new $root.languagecheck.Request(), value;
            while (reader.pos < end) {
                var start = reader.pos;
                var tag = reader.tag();
                if (tag === _end) {
                    _end = undefined;
                    break;
                }
                var wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 0)
                            break;
                        if (typeof (value = reader.uint64()) === "object" ? value.low || value.high : value !== 0)
                            message.id = value;
                        else
                            delete message.id;
                        continue;
                    }
                case 2: {
                        if (wireType !== 2)
                            break;
                        message.checkProse = $root.languagecheck.CheckRequest.decode(reader, reader.uint32(), undefined, _depth + 1, message.checkProse);
                        message.payload = "checkProse";
                        continue;
                    }
                case 3: {
                        if (wireType !== 2)
                            break;
                        message.getMetadata = $root.languagecheck.MetadataRequest.decode(reader, reader.uint32(), undefined, _depth + 1, message.getMetadata);
                        message.payload = "getMetadata";
                        continue;
                    }
                case 4: {
                        if (wireType !== 2)
                            break;
                        message.ignore = $root.languagecheck.IgnoreRequest.decode(reader, reader.uint32(), undefined, _depth + 1, message.ignore);
                        message.payload = "ignore";
                        continue;
                    }
                case 5: {
                        if (wireType !== 2)
                            break;
                        message.initialize = $root.languagecheck.InitializeRequest.decode(reader, reader.uint32(), undefined, _depth + 1, message.initialize);
                        message.payload = "initialize";
                        continue;
                    }
                case 6: {
                        if (wireType !== 2)
                            break;
                        message.addDictionaryWord = $root.languagecheck.AddDictionaryWordRequest.decode(reader, reader.uint32(), undefined, _depth + 1, message.addDictionaryWord);
                        message.payload = "addDictionaryWord";
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                $util.makeProp(message, "$unknowns", false);
                (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
            }
            if (_end !== undefined)
                throw Error("missing end group");
            return message;
        };

        /**
         * Decodes a Request message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof languagecheck.Request
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {languagecheck.Request & languagecheck.Request.$Shape} Request
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        Request.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a Request message.
         * @function verify
         * @memberof languagecheck.Request
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        Request.verify = function verify(message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            var properties = {};
            if (message.id != null && message.hasOwnProperty("id"))
                if (!$util.isInteger(message.id) && !(message.id && $util.isInteger(message.id.low) && $util.isInteger(message.id.high)))
                    return "id: integer|Long expected";
            if (message.checkProse != null && message.hasOwnProperty("checkProse")) {
                properties.payload = 1;
                {
                    var error = $root.languagecheck.CheckRequest.verify(message.checkProse, _depth + 1);
                    if (error)
                        return "checkProse." + error;
                }
            }
            if (message.getMetadata != null && message.hasOwnProperty("getMetadata")) {
                if (properties.payload === 1)
                    return "payload: multiple values";
                properties.payload = 1;
                {
                    var error = $root.languagecheck.MetadataRequest.verify(message.getMetadata, _depth + 1);
                    if (error)
                        return "getMetadata." + error;
                }
            }
            if (message.ignore != null && message.hasOwnProperty("ignore")) {
                if (properties.payload === 1)
                    return "payload: multiple values";
                properties.payload = 1;
                {
                    var error = $root.languagecheck.IgnoreRequest.verify(message.ignore, _depth + 1);
                    if (error)
                        return "ignore." + error;
                }
            }
            if (message.initialize != null && message.hasOwnProperty("initialize")) {
                if (properties.payload === 1)
                    return "payload: multiple values";
                properties.payload = 1;
                {
                    var error = $root.languagecheck.InitializeRequest.verify(message.initialize, _depth + 1);
                    if (error)
                        return "initialize." + error;
                }
            }
            if (message.addDictionaryWord != null && message.hasOwnProperty("addDictionaryWord")) {
                if (properties.payload === 1)
                    return "payload: multiple values";
                properties.payload = 1;
                {
                    var error = $root.languagecheck.AddDictionaryWordRequest.verify(message.addDictionaryWord, _depth + 1);
                    if (error)
                        return "addDictionaryWord." + error;
                }
            }
            return null;
        };

        /**
         * Creates a Request message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof languagecheck.Request
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {languagecheck.Request} Request
         */
        Request.fromObject = function fromObject(object, _depth) {
            if (object instanceof $root.languagecheck.Request)
                return object;
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            var message = new $root.languagecheck.Request();
            if (object.id != null)
                if (typeof object.id === "object" ? object.id.low || object.id.high : Number(object.id) !== 0)
                    if ($util.Long)
                        message.id = $util.Long.fromValue(object.id, true);
                    else if (typeof object.id === "string")
                        message.id = parseInt(object.id, 10);
                    else if (typeof object.id === "number")
                        message.id = object.id;
                    else if (typeof object.id === "object")
                        message.id = new $util.LongBits(object.id.low >>> 0, object.id.high >>> 0).toNumber(true);
            if (object.checkProse != null) {
                if (typeof object.checkProse !== "object")
                    throw TypeError(".languagecheck.Request.checkProse: object expected");
                message.checkProse = $root.languagecheck.CheckRequest.fromObject(object.checkProse, _depth + 1);
            }
            if (object.getMetadata != null) {
                if (typeof object.getMetadata !== "object")
                    throw TypeError(".languagecheck.Request.getMetadata: object expected");
                message.getMetadata = $root.languagecheck.MetadataRequest.fromObject(object.getMetadata, _depth + 1);
            }
            if (object.ignore != null) {
                if (typeof object.ignore !== "object")
                    throw TypeError(".languagecheck.Request.ignore: object expected");
                message.ignore = $root.languagecheck.IgnoreRequest.fromObject(object.ignore, _depth + 1);
            }
            if (object.initialize != null) {
                if (typeof object.initialize !== "object")
                    throw TypeError(".languagecheck.Request.initialize: object expected");
                message.initialize = $root.languagecheck.InitializeRequest.fromObject(object.initialize, _depth + 1);
            }
            if (object.addDictionaryWord != null) {
                if (typeof object.addDictionaryWord !== "object")
                    throw TypeError(".languagecheck.Request.addDictionaryWord: object expected");
                message.addDictionaryWord = $root.languagecheck.AddDictionaryWordRequest.fromObject(object.addDictionaryWord, _depth + 1);
            }
            return message;
        };

        /**
         * Creates a plain object from a Request message. Also converts values to other types if specified.
         * @function toObject
         * @memberof languagecheck.Request
         * @static
         * @param {languagecheck.Request} message Request
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        Request.toObject = function toObject(message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            var object = {};
            if (options.defaults)
                if ($util.Long) {
                    var long = new $util.Long(0, 0, true);
                    object.id = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : typeof BigInt !== "undefined" && options.longs === BigInt ? long.toBigInt() : long;
                } else
                    object.id = options.longs === String ? "0" : typeof BigInt !== "undefined" && options.longs === BigInt ? BigInt("0") : 0;
            if (message.id != null && message.hasOwnProperty("id"))
                if (typeof BigInt !== "undefined" && options.longs === BigInt)
                    object.id = typeof message.id === "number" ? BigInt(message.id) : $util.Long.fromBits(message.id.low >>> 0, message.id.high >>> 0, true).toBigInt();
                else if (typeof message.id === "number")
                    object.id = options.longs === String ? String(message.id) : message.id;
                else
                    object.id = options.longs === String ? $util.Long.prototype.toString.call(message.id) : options.longs === Number ? new $util.LongBits(message.id.low >>> 0, message.id.high >>> 0).toNumber(true) : message.id;
            if (message.checkProse != null && message.hasOwnProperty("checkProse")) {
                object.checkProse = $root.languagecheck.CheckRequest.toObject(message.checkProse, options, _depth + 1);
                if (options.oneofs)
                    object.payload = "checkProse";
            }
            if (message.getMetadata != null && message.hasOwnProperty("getMetadata")) {
                object.getMetadata = $root.languagecheck.MetadataRequest.toObject(message.getMetadata, options, _depth + 1);
                if (options.oneofs)
                    object.payload = "getMetadata";
            }
            if (message.ignore != null && message.hasOwnProperty("ignore")) {
                object.ignore = $root.languagecheck.IgnoreRequest.toObject(message.ignore, options, _depth + 1);
                if (options.oneofs)
                    object.payload = "ignore";
            }
            if (message.initialize != null && message.hasOwnProperty("initialize")) {
                object.initialize = $root.languagecheck.InitializeRequest.toObject(message.initialize, options, _depth + 1);
                if (options.oneofs)
                    object.payload = "initialize";
            }
            if (message.addDictionaryWord != null && message.hasOwnProperty("addDictionaryWord")) {
                object.addDictionaryWord = $root.languagecheck.AddDictionaryWordRequest.toObject(message.addDictionaryWord, options, _depth + 1);
                if (options.oneofs)
                    object.payload = "addDictionaryWord";
            }
            return object;
        };

        /**
         * Converts this Request to JSON.
         * @function toJSON
         * @memberof languagecheck.Request
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        Request.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the type url for Request
         * @function getTypeUrl
         * @memberof languagecheck.Request
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        Request.getTypeUrl = function getTypeUrl(prefix) {
            if (prefix === undefined)
                prefix = "type.googleapis.com";
            return prefix + "/languagecheck.Request";
        };

        return Request;
    })();

    languagecheck.InitializeRequest = (function() {

        /**
         * Properties of an InitializeRequest.
         * @typedef {Object} languagecheck.InitializeRequest.$Properties
         * @property {string|null} [workspaceRoot] InitializeRequest workspaceRoot
         * @property {boolean|null} [indexOnOpen] InitializeRequest indexOnOpen
         * @property {string|null} [dbPath] InitializeRequest dbPath
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding
         */

        /**
         * Properties of an InitializeRequest.
         * @memberof languagecheck
         * @interface IInitializeRequest
         * @augments languagecheck.InitializeRequest.$Properties
         * @deprecated Use languagecheck.InitializeRequest.$Properties instead.
         */

        /**
         * Shape of an InitializeRequest.
         * @typedef {languagecheck.InitializeRequest.$Properties} languagecheck.InitializeRequest.$Shape
         */

        /**
         * Constructs a new InitializeRequest.
         * @memberof languagecheck
         * @classdesc Represents an InitializeRequest.
         * @constructor
         * @param {languagecheck.InitializeRequest.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding
         */
        function InitializeRequest(properties) {
            if (properties)
                for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * InitializeRequest workspaceRoot.
         * @member {string} workspaceRoot
         * @memberof languagecheck.InitializeRequest
         * @instance
         */
        InitializeRequest.prototype.workspaceRoot = "";

        /**
         * InitializeRequest indexOnOpen.
         * @member {boolean|null|undefined} indexOnOpen
         * @memberof languagecheck.InitializeRequest
         * @instance
         */
        InitializeRequest.prototype.indexOnOpen = null;

        /**
         * InitializeRequest dbPath.
         * @member {string|null|undefined} dbPath
         * @memberof languagecheck.InitializeRequest
         * @instance
         */
        InitializeRequest.prototype.dbPath = null;

        // OneOf field names bound to virtual getters and setters
        var $oneOfFields;

        // Virtual OneOf for proto3 optional field
        Object.defineProperty(InitializeRequest.prototype, "_indexOnOpen", {
            get: $util.oneOfGetter($oneOfFields = ["indexOnOpen"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        // Virtual OneOf for proto3 optional field
        Object.defineProperty(InitializeRequest.prototype, "_dbPath", {
            get: $util.oneOfGetter($oneOfFields = ["dbPath"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        /**
         * Creates a new InitializeRequest instance using the specified properties.
         * @function create
         * @memberof languagecheck.InitializeRequest
         * @static
         * @param {languagecheck.InitializeRequest.$Properties=} [properties] Properties to set
         * @returns {languagecheck.InitializeRequest} InitializeRequest instance
         * @type {{
         *   (properties: languagecheck.InitializeRequest.$Shape): languagecheck.InitializeRequest & languagecheck.InitializeRequest.$Shape;
         *   (properties?: languagecheck.InitializeRequest.$Properties): languagecheck.InitializeRequest;
         * }}
         */
        InitializeRequest.create = function create(properties) {
            return new InitializeRequest(properties);
        };

        /**
         * Encodes the specified InitializeRequest message. Does not implicitly {@link languagecheck.InitializeRequest.verify|verify} messages.
         * @function encode
         * @memberof languagecheck.InitializeRequest
         * @static
         * @param {languagecheck.InitializeRequest.$Properties} message InitializeRequest message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        InitializeRequest.encode = function encode(message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            if (message.workspaceRoot != null && Object.hasOwnProperty.call(message, "workspaceRoot"))
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.workspaceRoot);
            if (message.indexOnOpen != null && Object.hasOwnProperty.call(message, "indexOnOpen"))
                writer.uint32(/* id 2, wireType 0 =*/16).bool(message.indexOnOpen);
            if (message.dbPath != null && Object.hasOwnProperty.call(message, "dbPath"))
                writer.uint32(/* id 3, wireType 2 =*/26).string(message.dbPath);
            if (message.$unknowns != null && Object.hasOwnProperty.call(message, "$unknowns"))
                for (var i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Encodes the specified InitializeRequest message, length delimited. Does not implicitly {@link languagecheck.InitializeRequest.verify|verify} messages.
         * @function encodeDelimited
         * @memberof languagecheck.InitializeRequest
         * @static
         * @param {languagecheck.InitializeRequest.$Properties} message InitializeRequest message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        InitializeRequest.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer && writer.len ? writer.fork() : writer).ldelim();
        };

        /**
         * Decodes an InitializeRequest message from the specified reader or buffer.
         * @function decode
         * @memberof languagecheck.InitializeRequest
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {languagecheck.InitializeRequest & languagecheck.InitializeRequest.$Shape} InitializeRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        InitializeRequest.decode = function decode(reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw Error("max depth exceeded");
            var end = length === undefined ? reader.len : reader.pos + length, message = _target || new $root.languagecheck.InitializeRequest(), value;
            while (reader.pos < end) {
                var start = reader.pos;
                var tag = reader.tag();
                if (tag === _end) {
                    _end = undefined;
                    break;
                }
                var wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.string()).length)
                            message.workspaceRoot = value;
                        else
                            delete message.workspaceRoot;
                        continue;
                    }
                case 2: {
                        if (wireType !== 0)
                            break;
                        message.indexOnOpen = reader.bool();
                        message._indexOnOpen = "indexOnOpen";
                        continue;
                    }
                case 3: {
                        if (wireType !== 2)
                            break;
                        message.dbPath = reader.string();
                        message._dbPath = "dbPath";
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                $util.makeProp(message, "$unknowns", false);
                (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
            }
            if (_end !== undefined)
                throw Error("missing end group");
            return message;
        };

        /**
         * Decodes an InitializeRequest message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof languagecheck.InitializeRequest
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {languagecheck.InitializeRequest & languagecheck.InitializeRequest.$Shape} InitializeRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        InitializeRequest.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies an InitializeRequest message.
         * @function verify
         * @memberof languagecheck.InitializeRequest
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        InitializeRequest.verify = function verify(message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            var properties = {};
            if (message.workspaceRoot != null && message.hasOwnProperty("workspaceRoot"))
                if (!$util.isString(message.workspaceRoot))
                    return "workspaceRoot: string expected";
            if (message.indexOnOpen != null && message.hasOwnProperty("indexOnOpen")) {
                properties._indexOnOpen = 1;
                if (typeof message.indexOnOpen !== "boolean")
                    return "indexOnOpen: boolean expected";
            }
            if (message.dbPath != null && message.hasOwnProperty("dbPath")) {
                properties._dbPath = 1;
                if (!$util.isString(message.dbPath))
                    return "dbPath: string expected";
            }
            return null;
        };

        /**
         * Creates an InitializeRequest message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof languagecheck.InitializeRequest
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {languagecheck.InitializeRequest} InitializeRequest
         */
        InitializeRequest.fromObject = function fromObject(object, _depth) {
            if (object instanceof $root.languagecheck.InitializeRequest)
                return object;
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            var message = new $root.languagecheck.InitializeRequest();
            if (object.workspaceRoot != null)
                if (typeof object.workspaceRoot !== "string" || object.workspaceRoot.length)
                    message.workspaceRoot = String(object.workspaceRoot);
            if (object.indexOnOpen != null)
                message.indexOnOpen = Boolean(object.indexOnOpen);
            if (object.dbPath != null)
                message.dbPath = String(object.dbPath);
            return message;
        };

        /**
         * Creates a plain object from an InitializeRequest message. Also converts values to other types if specified.
         * @function toObject
         * @memberof languagecheck.InitializeRequest
         * @static
         * @param {languagecheck.InitializeRequest} message InitializeRequest
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        InitializeRequest.toObject = function toObject(message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            var object = {};
            if (options.defaults)
                object.workspaceRoot = "";
            if (message.workspaceRoot != null && message.hasOwnProperty("workspaceRoot"))
                object.workspaceRoot = message.workspaceRoot;
            if (message.indexOnOpen != null && message.hasOwnProperty("indexOnOpen"))
                object.indexOnOpen = message.indexOnOpen;
            if (message.dbPath != null && message.hasOwnProperty("dbPath"))
                object.dbPath = message.dbPath;
            return object;
        };

        /**
         * Converts this InitializeRequest to JSON.
         * @function toJSON
         * @memberof languagecheck.InitializeRequest
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        InitializeRequest.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the type url for InitializeRequest
         * @function getTypeUrl
         * @memberof languagecheck.InitializeRequest
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        InitializeRequest.getTypeUrl = function getTypeUrl(prefix) {
            if (prefix === undefined)
                prefix = "type.googleapis.com";
            return prefix + "/languagecheck.InitializeRequest";
        };

        return InitializeRequest;
    })();

    languagecheck.IgnoreRequest = (function() {

        /**
         * Properties of an IgnoreRequest.
         * @typedef {Object} languagecheck.IgnoreRequest.$Properties
         * @property {string|null} [message] IgnoreRequest message
         * @property {string|null} [context] IgnoreRequest context
         * @property {string|null} [text] IgnoreRequest text
         * @property {number|null} [startByte] IgnoreRequest startByte
         * @property {number|null} [endByte] IgnoreRequest endByte
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding
         */

        /**
         * Properties of an IgnoreRequest.
         * @memberof languagecheck
         * @interface IIgnoreRequest
         * @augments languagecheck.IgnoreRequest.$Properties
         * @deprecated Use languagecheck.IgnoreRequest.$Properties instead.
         */

        /**
         * Shape of an IgnoreRequest.
         * @typedef {languagecheck.IgnoreRequest.$Properties} languagecheck.IgnoreRequest.$Shape
         */

        /**
         * Constructs a new IgnoreRequest.
         * @memberof languagecheck
         * @classdesc Represents an IgnoreRequest.
         * @constructor
         * @param {languagecheck.IgnoreRequest.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding
         */
        function IgnoreRequest(properties) {
            if (properties)
                for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * IgnoreRequest message.
         * @member {string} message
         * @memberof languagecheck.IgnoreRequest
         * @instance
         */
        IgnoreRequest.prototype.message = "";

        /**
         * IgnoreRequest context.
         * @member {string} context
         * @memberof languagecheck.IgnoreRequest
         * @instance
         */
        IgnoreRequest.prototype.context = "";

        /**
         * IgnoreRequest text.
         * @member {string} text
         * @memberof languagecheck.IgnoreRequest
         * @instance
         */
        IgnoreRequest.prototype.text = "";

        /**
         * IgnoreRequest startByte.
         * @member {number} startByte
         * @memberof languagecheck.IgnoreRequest
         * @instance
         */
        IgnoreRequest.prototype.startByte = 0;

        /**
         * IgnoreRequest endByte.
         * @member {number} endByte
         * @memberof languagecheck.IgnoreRequest
         * @instance
         */
        IgnoreRequest.prototype.endByte = 0;

        /**
         * Creates a new IgnoreRequest instance using the specified properties.
         * @function create
         * @memberof languagecheck.IgnoreRequest
         * @static
         * @param {languagecheck.IgnoreRequest.$Properties=} [properties] Properties to set
         * @returns {languagecheck.IgnoreRequest} IgnoreRequest instance
         * @type {{
         *   (properties: languagecheck.IgnoreRequest.$Shape): languagecheck.IgnoreRequest & languagecheck.IgnoreRequest.$Shape;
         *   (properties?: languagecheck.IgnoreRequest.$Properties): languagecheck.IgnoreRequest;
         * }}
         */
        IgnoreRequest.create = function create(properties) {
            return new IgnoreRequest(properties);
        };

        /**
         * Encodes the specified IgnoreRequest message. Does not implicitly {@link languagecheck.IgnoreRequest.verify|verify} messages.
         * @function encode
         * @memberof languagecheck.IgnoreRequest
         * @static
         * @param {languagecheck.IgnoreRequest.$Properties} message IgnoreRequest message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        IgnoreRequest.encode = function encode(message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            if (message.message != null && Object.hasOwnProperty.call(message, "message"))
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.message);
            if (message.context != null && Object.hasOwnProperty.call(message, "context"))
                writer.uint32(/* id 2, wireType 2 =*/18).string(message.context);
            if (message.text != null && Object.hasOwnProperty.call(message, "text"))
                writer.uint32(/* id 3, wireType 2 =*/26).string(message.text);
            if (message.startByte != null && Object.hasOwnProperty.call(message, "startByte"))
                writer.uint32(/* id 4, wireType 0 =*/32).uint32(message.startByte);
            if (message.endByte != null && Object.hasOwnProperty.call(message, "endByte"))
                writer.uint32(/* id 5, wireType 0 =*/40).uint32(message.endByte);
            if (message.$unknowns != null && Object.hasOwnProperty.call(message, "$unknowns"))
                for (var i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Encodes the specified IgnoreRequest message, length delimited. Does not implicitly {@link languagecheck.IgnoreRequest.verify|verify} messages.
         * @function encodeDelimited
         * @memberof languagecheck.IgnoreRequest
         * @static
         * @param {languagecheck.IgnoreRequest.$Properties} message IgnoreRequest message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        IgnoreRequest.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer && writer.len ? writer.fork() : writer).ldelim();
        };

        /**
         * Decodes an IgnoreRequest message from the specified reader or buffer.
         * @function decode
         * @memberof languagecheck.IgnoreRequest
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {languagecheck.IgnoreRequest & languagecheck.IgnoreRequest.$Shape} IgnoreRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        IgnoreRequest.decode = function decode(reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw Error("max depth exceeded");
            var end = length === undefined ? reader.len : reader.pos + length, message = _target || new $root.languagecheck.IgnoreRequest(), value;
            while (reader.pos < end) {
                var start = reader.pos;
                var tag = reader.tag();
                if (tag === _end) {
                    _end = undefined;
                    break;
                }
                var wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.string()).length)
                            message.message = value;
                        else
                            delete message.message;
                        continue;
                    }
                case 2: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.string()).length)
                            message.context = value;
                        else
                            delete message.context;
                        continue;
                    }
                case 3: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.string()).length)
                            message.text = value;
                        else
                            delete message.text;
                        continue;
                    }
                case 4: {
                        if (wireType !== 0)
                            break;
                        if (value = reader.uint32())
                            message.startByte = value;
                        else
                            delete message.startByte;
                        continue;
                    }
                case 5: {
                        if (wireType !== 0)
                            break;
                        if (value = reader.uint32())
                            message.endByte = value;
                        else
                            delete message.endByte;
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                $util.makeProp(message, "$unknowns", false);
                (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
            }
            if (_end !== undefined)
                throw Error("missing end group");
            return message;
        };

        /**
         * Decodes an IgnoreRequest message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof languagecheck.IgnoreRequest
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {languagecheck.IgnoreRequest & languagecheck.IgnoreRequest.$Shape} IgnoreRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        IgnoreRequest.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies an IgnoreRequest message.
         * @function verify
         * @memberof languagecheck.IgnoreRequest
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        IgnoreRequest.verify = function verify(message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (message.message != null && message.hasOwnProperty("message"))
                if (!$util.isString(message.message))
                    return "message: string expected";
            if (message.context != null && message.hasOwnProperty("context"))
                if (!$util.isString(message.context))
                    return "context: string expected";
            if (message.text != null && message.hasOwnProperty("text"))
                if (!$util.isString(message.text))
                    return "text: string expected";
            if (message.startByte != null && message.hasOwnProperty("startByte"))
                if (!$util.isInteger(message.startByte))
                    return "startByte: integer expected";
            if (message.endByte != null && message.hasOwnProperty("endByte"))
                if (!$util.isInteger(message.endByte))
                    return "endByte: integer expected";
            return null;
        };

        /**
         * Creates an IgnoreRequest message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof languagecheck.IgnoreRequest
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {languagecheck.IgnoreRequest} IgnoreRequest
         */
        IgnoreRequest.fromObject = function fromObject(object, _depth) {
            if (object instanceof $root.languagecheck.IgnoreRequest)
                return object;
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            var message = new $root.languagecheck.IgnoreRequest();
            if (object.message != null)
                if (typeof object.message !== "string" || object.message.length)
                    message.message = String(object.message);
            if (object.context != null)
                if (typeof object.context !== "string" || object.context.length)
                    message.context = String(object.context);
            if (object.text != null)
                if (typeof object.text !== "string" || object.text.length)
                    message.text = String(object.text);
            if (object.startByte != null)
                if (Number(object.startByte) !== 0)
                    message.startByte = object.startByte >>> 0;
            if (object.endByte != null)
                if (Number(object.endByte) !== 0)
                    message.endByte = object.endByte >>> 0;
            return message;
        };

        /**
         * Creates a plain object from an IgnoreRequest message. Also converts values to other types if specified.
         * @function toObject
         * @memberof languagecheck.IgnoreRequest
         * @static
         * @param {languagecheck.IgnoreRequest} message IgnoreRequest
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        IgnoreRequest.toObject = function toObject(message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            var object = {};
            if (options.defaults) {
                object.message = "";
                object.context = "";
                object.text = "";
                object.startByte = 0;
                object.endByte = 0;
            }
            if (message.message != null && message.hasOwnProperty("message"))
                object.message = message.message;
            if (message.context != null && message.hasOwnProperty("context"))
                object.context = message.context;
            if (message.text != null && message.hasOwnProperty("text"))
                object.text = message.text;
            if (message.startByte != null && message.hasOwnProperty("startByte"))
                object.startByte = message.startByte;
            if (message.endByte != null && message.hasOwnProperty("endByte"))
                object.endByte = message.endByte;
            return object;
        };

        /**
         * Converts this IgnoreRequest to JSON.
         * @function toJSON
         * @memberof languagecheck.IgnoreRequest
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        IgnoreRequest.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the type url for IgnoreRequest
         * @function getTypeUrl
         * @memberof languagecheck.IgnoreRequest
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        IgnoreRequest.getTypeUrl = function getTypeUrl(prefix) {
            if (prefix === undefined)
                prefix = "type.googleapis.com";
            return prefix + "/languagecheck.IgnoreRequest";
        };

        return IgnoreRequest;
    })();

    languagecheck.Response = (function() {

        /**
         * Properties of a Response.
         * @typedef {Object} languagecheck.Response.$Properties
         * @property {number|Long|null} [id] Response id
         * @property {languagecheck.CheckResponse.$Properties|null} [checkProse] Response checkProse
         * @property {languagecheck.MetadataResponse.$Properties|null} [getMetadata] Response getMetadata
         * @property {languagecheck.ErrorResponse.$Properties|null} [error] Response error
         * @property {languagecheck.OkResponse.$Properties|null} [ok] Response ok
         * @property {"checkProse"|"getMetadata"|"error"|"ok"} [payload] Response payload
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding
         */

        /**
         * Properties of a Response.
         * @memberof languagecheck
         * @interface IResponse
         * @augments languagecheck.Response.$Properties
         * @deprecated Use languagecheck.Response.$Properties instead.
         */

        /**
         * Narrowed shape of a Response.
         * @typedef {{
         *   id?: number|Long|null;
         *   checkProse?: languagecheck.CheckResponse.$Shape|null;
         *   getMetadata?: languagecheck.MetadataResponse.$Shape|null;
         *   error?: languagecheck.ErrorResponse.$Shape|null;
         *   ok?: languagecheck.OkResponse.$Shape|null;
         *   $unknowns?: Array.<Uint8Array>;
         * } & (
         *   ({ payload?: undefined; checkProse?: null; getMetadata?: null; error?: null; ok?: null }|{ payload?: "checkProse"; checkProse: languagecheck.CheckResponse.$Shape; getMetadata?: null; error?: null; ok?: null }|{ payload?: "getMetadata"; checkProse?: null; getMetadata: languagecheck.MetadataResponse.$Shape; error?: null; ok?: null }|{ payload?: "error"; checkProse?: null; getMetadata?: null; error: languagecheck.ErrorResponse.$Shape; ok?: null }|{ payload?: "ok"; checkProse?: null; getMetadata?: null; error?: null; ok: languagecheck.OkResponse.$Shape })
         * )} languagecheck.Response.$Shape
         */

        /**
         * Constructs a new Response.
         * @memberof languagecheck
         * @classdesc Represents a Response.
         * @constructor
         * @param {languagecheck.Response.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding
         */
        function Response(properties) {
            if (properties)
                for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * Response id.
         * @member {number|Long} id
         * @memberof languagecheck.Response
         * @instance
         */
        Response.prototype.id = $util.Long ? $util.Long.fromBits(0,0,true) : 0;

        /**
         * Response checkProse.
         * @member {languagecheck.CheckResponse.$Properties|null|undefined} checkProse
         * @memberof languagecheck.Response
         * @instance
         */
        Response.prototype.checkProse = null;

        /**
         * Response getMetadata.
         * @member {languagecheck.MetadataResponse.$Properties|null|undefined} getMetadata
         * @memberof languagecheck.Response
         * @instance
         */
        Response.prototype.getMetadata = null;

        /**
         * Response error.
         * @member {languagecheck.ErrorResponse.$Properties|null|undefined} error
         * @memberof languagecheck.Response
         * @instance
         */
        Response.prototype.error = null;

        /**
         * Response ok.
         * @member {languagecheck.OkResponse.$Properties|null|undefined} ok
         * @memberof languagecheck.Response
         * @instance
         */
        Response.prototype.ok = null;

        // OneOf field names bound to virtual getters and setters
        var $oneOfFields;

        /**
         * Response payload.
         * @member {"checkProse"|"getMetadata"|"error"|"ok"|undefined} payload
         * @memberof languagecheck.Response
         * @instance
         */
        Object.defineProperty(Response.prototype, "payload", {
            get: $util.oneOfGetter($oneOfFields = ["checkProse", "getMetadata", "error", "ok"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        /**
         * Creates a new Response instance using the specified properties.
         * @function create
         * @memberof languagecheck.Response
         * @static
         * @param {languagecheck.Response.$Properties=} [properties] Properties to set
         * @returns {languagecheck.Response} Response instance
         * @type {{
         *   (properties: languagecheck.Response.$Shape): languagecheck.Response & languagecheck.Response.$Shape;
         *   (properties?: languagecheck.Response.$Properties): languagecheck.Response;
         * }}
         */
        Response.create = function create(properties) {
            return new Response(properties);
        };

        /**
         * Encodes the specified Response message. Does not implicitly {@link languagecheck.Response.verify|verify} messages.
         * @function encode
         * @memberof languagecheck.Response
         * @static
         * @param {languagecheck.Response.$Properties} message Response message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Response.encode = function encode(message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            if (message.id != null && Object.hasOwnProperty.call(message, "id"))
                writer.uint32(/* id 1, wireType 0 =*/8).uint64(message.id);
            if (message.checkProse != null && Object.hasOwnProperty.call(message, "checkProse"))
                $root.languagecheck.CheckResponse.encode(message.checkProse, writer.uint32(/* id 2, wireType 2 =*/18).fork(), _depth + 1).ldelim();
            if (message.getMetadata != null && Object.hasOwnProperty.call(message, "getMetadata"))
                $root.languagecheck.MetadataResponse.encode(message.getMetadata, writer.uint32(/* id 3, wireType 2 =*/26).fork(), _depth + 1).ldelim();
            if (message.error != null && Object.hasOwnProperty.call(message, "error"))
                $root.languagecheck.ErrorResponse.encode(message.error, writer.uint32(/* id 4, wireType 2 =*/34).fork(), _depth + 1).ldelim();
            if (message.ok != null && Object.hasOwnProperty.call(message, "ok"))
                $root.languagecheck.OkResponse.encode(message.ok, writer.uint32(/* id 5, wireType 2 =*/42).fork(), _depth + 1).ldelim();
            if (message.$unknowns != null && Object.hasOwnProperty.call(message, "$unknowns"))
                for (var i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Encodes the specified Response message, length delimited. Does not implicitly {@link languagecheck.Response.verify|verify} messages.
         * @function encodeDelimited
         * @memberof languagecheck.Response
         * @static
         * @param {languagecheck.Response.$Properties} message Response message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Response.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer && writer.len ? writer.fork() : writer).ldelim();
        };

        /**
         * Decodes a Response message from the specified reader or buffer.
         * @function decode
         * @memberof languagecheck.Response
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {languagecheck.Response & languagecheck.Response.$Shape} Response
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        Response.decode = function decode(reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw Error("max depth exceeded");
            var end = length === undefined ? reader.len : reader.pos + length, message = _target || new $root.languagecheck.Response(), value;
            while (reader.pos < end) {
                var start = reader.pos;
                var tag = reader.tag();
                if (tag === _end) {
                    _end = undefined;
                    break;
                }
                var wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 0)
                            break;
                        if (typeof (value = reader.uint64()) === "object" ? value.low || value.high : value !== 0)
                            message.id = value;
                        else
                            delete message.id;
                        continue;
                    }
                case 2: {
                        if (wireType !== 2)
                            break;
                        message.checkProse = $root.languagecheck.CheckResponse.decode(reader, reader.uint32(), undefined, _depth + 1, message.checkProse);
                        message.payload = "checkProse";
                        continue;
                    }
                case 3: {
                        if (wireType !== 2)
                            break;
                        message.getMetadata = $root.languagecheck.MetadataResponse.decode(reader, reader.uint32(), undefined, _depth + 1, message.getMetadata);
                        message.payload = "getMetadata";
                        continue;
                    }
                case 4: {
                        if (wireType !== 2)
                            break;
                        message.error = $root.languagecheck.ErrorResponse.decode(reader, reader.uint32(), undefined, _depth + 1, message.error);
                        message.payload = "error";
                        continue;
                    }
                case 5: {
                        if (wireType !== 2)
                            break;
                        message.ok = $root.languagecheck.OkResponse.decode(reader, reader.uint32(), undefined, _depth + 1, message.ok);
                        message.payload = "ok";
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                $util.makeProp(message, "$unknowns", false);
                (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
            }
            if (_end !== undefined)
                throw Error("missing end group");
            return message;
        };

        /**
         * Decodes a Response message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof languagecheck.Response
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {languagecheck.Response & languagecheck.Response.$Shape} Response
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        Response.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a Response message.
         * @function verify
         * @memberof languagecheck.Response
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        Response.verify = function verify(message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            var properties = {};
            if (message.id != null && message.hasOwnProperty("id"))
                if (!$util.isInteger(message.id) && !(message.id && $util.isInteger(message.id.low) && $util.isInteger(message.id.high)))
                    return "id: integer|Long expected";
            if (message.checkProse != null && message.hasOwnProperty("checkProse")) {
                properties.payload = 1;
                {
                    var error = $root.languagecheck.CheckResponse.verify(message.checkProse, _depth + 1);
                    if (error)
                        return "checkProse." + error;
                }
            }
            if (message.getMetadata != null && message.hasOwnProperty("getMetadata")) {
                if (properties.payload === 1)
                    return "payload: multiple values";
                properties.payload = 1;
                {
                    var error = $root.languagecheck.MetadataResponse.verify(message.getMetadata, _depth + 1);
                    if (error)
                        return "getMetadata." + error;
                }
            }
            if (message.error != null && message.hasOwnProperty("error")) {
                if (properties.payload === 1)
                    return "payload: multiple values";
                properties.payload = 1;
                {
                    var error = $root.languagecheck.ErrorResponse.verify(message.error, _depth + 1);
                    if (error)
                        return "error." + error;
                }
            }
            if (message.ok != null && message.hasOwnProperty("ok")) {
                if (properties.payload === 1)
                    return "payload: multiple values";
                properties.payload = 1;
                {
                    var error = $root.languagecheck.OkResponse.verify(message.ok, _depth + 1);
                    if (error)
                        return "ok." + error;
                }
            }
            return null;
        };

        /**
         * Creates a Response message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof languagecheck.Response
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {languagecheck.Response} Response
         */
        Response.fromObject = function fromObject(object, _depth) {
            if (object instanceof $root.languagecheck.Response)
                return object;
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            var message = new $root.languagecheck.Response();
            if (object.id != null)
                if (typeof object.id === "object" ? object.id.low || object.id.high : Number(object.id) !== 0)
                    if ($util.Long)
                        message.id = $util.Long.fromValue(object.id, true);
                    else if (typeof object.id === "string")
                        message.id = parseInt(object.id, 10);
                    else if (typeof object.id === "number")
                        message.id = object.id;
                    else if (typeof object.id === "object")
                        message.id = new $util.LongBits(object.id.low >>> 0, object.id.high >>> 0).toNumber(true);
            if (object.checkProse != null) {
                if (typeof object.checkProse !== "object")
                    throw TypeError(".languagecheck.Response.checkProse: object expected");
                message.checkProse = $root.languagecheck.CheckResponse.fromObject(object.checkProse, _depth + 1);
            }
            if (object.getMetadata != null) {
                if (typeof object.getMetadata !== "object")
                    throw TypeError(".languagecheck.Response.getMetadata: object expected");
                message.getMetadata = $root.languagecheck.MetadataResponse.fromObject(object.getMetadata, _depth + 1);
            }
            if (object.error != null) {
                if (typeof object.error !== "object")
                    throw TypeError(".languagecheck.Response.error: object expected");
                message.error = $root.languagecheck.ErrorResponse.fromObject(object.error, _depth + 1);
            }
            if (object.ok != null) {
                if (typeof object.ok !== "object")
                    throw TypeError(".languagecheck.Response.ok: object expected");
                message.ok = $root.languagecheck.OkResponse.fromObject(object.ok, _depth + 1);
            }
            return message;
        };

        /**
         * Creates a plain object from a Response message. Also converts values to other types if specified.
         * @function toObject
         * @memberof languagecheck.Response
         * @static
         * @param {languagecheck.Response} message Response
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        Response.toObject = function toObject(message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            var object = {};
            if (options.defaults)
                if ($util.Long) {
                    var long = new $util.Long(0, 0, true);
                    object.id = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : typeof BigInt !== "undefined" && options.longs === BigInt ? long.toBigInt() : long;
                } else
                    object.id = options.longs === String ? "0" : typeof BigInt !== "undefined" && options.longs === BigInt ? BigInt("0") : 0;
            if (message.id != null && message.hasOwnProperty("id"))
                if (typeof BigInt !== "undefined" && options.longs === BigInt)
                    object.id = typeof message.id === "number" ? BigInt(message.id) : $util.Long.fromBits(message.id.low >>> 0, message.id.high >>> 0, true).toBigInt();
                else if (typeof message.id === "number")
                    object.id = options.longs === String ? String(message.id) : message.id;
                else
                    object.id = options.longs === String ? $util.Long.prototype.toString.call(message.id) : options.longs === Number ? new $util.LongBits(message.id.low >>> 0, message.id.high >>> 0).toNumber(true) : message.id;
            if (message.checkProse != null && message.hasOwnProperty("checkProse")) {
                object.checkProse = $root.languagecheck.CheckResponse.toObject(message.checkProse, options, _depth + 1);
                if (options.oneofs)
                    object.payload = "checkProse";
            }
            if (message.getMetadata != null && message.hasOwnProperty("getMetadata")) {
                object.getMetadata = $root.languagecheck.MetadataResponse.toObject(message.getMetadata, options, _depth + 1);
                if (options.oneofs)
                    object.payload = "getMetadata";
            }
            if (message.error != null && message.hasOwnProperty("error")) {
                object.error = $root.languagecheck.ErrorResponse.toObject(message.error, options, _depth + 1);
                if (options.oneofs)
                    object.payload = "error";
            }
            if (message.ok != null && message.hasOwnProperty("ok")) {
                object.ok = $root.languagecheck.OkResponse.toObject(message.ok, options, _depth + 1);
                if (options.oneofs)
                    object.payload = "ok";
            }
            return object;
        };

        /**
         * Converts this Response to JSON.
         * @function toJSON
         * @memberof languagecheck.Response
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        Response.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the type url for Response
         * @function getTypeUrl
         * @memberof languagecheck.Response
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        Response.getTypeUrl = function getTypeUrl(prefix) {
            if (prefix === undefined)
                prefix = "type.googleapis.com";
            return prefix + "/languagecheck.Response";
        };

        return Response;
    })();

    languagecheck.OkResponse = (function() {

        /**
         * Properties of an OkResponse.
         * @typedef {Object} languagecheck.OkResponse.$Properties
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding
         */

        /**
         * Properties of an OkResponse.
         * @memberof languagecheck
         * @interface IOkResponse
         * @augments languagecheck.OkResponse.$Properties
         * @deprecated Use languagecheck.OkResponse.$Properties instead.
         */

        /**
         * Shape of an OkResponse.
         * @typedef {languagecheck.OkResponse.$Properties} languagecheck.OkResponse.$Shape
         */

        /**
         * Constructs a new OkResponse.
         * @memberof languagecheck
         * @classdesc Represents an OkResponse.
         * @constructor
         * @param {languagecheck.OkResponse.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding
         */
        function OkResponse(properties) {
            if (properties)
                for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * Creates a new OkResponse instance using the specified properties.
         * @function create
         * @memberof languagecheck.OkResponse
         * @static
         * @param {languagecheck.OkResponse.$Properties=} [properties] Properties to set
         * @returns {languagecheck.OkResponse} OkResponse instance
         * @type {{
         *   (properties: languagecheck.OkResponse.$Shape): languagecheck.OkResponse & languagecheck.OkResponse.$Shape;
         *   (properties?: languagecheck.OkResponse.$Properties): languagecheck.OkResponse;
         * }}
         */
        OkResponse.create = function create(properties) {
            return new OkResponse(properties);
        };

        /**
         * Encodes the specified OkResponse message. Does not implicitly {@link languagecheck.OkResponse.verify|verify} messages.
         * @function encode
         * @memberof languagecheck.OkResponse
         * @static
         * @param {languagecheck.OkResponse.$Properties} message OkResponse message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        OkResponse.encode = function encode(message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            if (message.$unknowns != null && Object.hasOwnProperty.call(message, "$unknowns"))
                for (var i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Encodes the specified OkResponse message, length delimited. Does not implicitly {@link languagecheck.OkResponse.verify|verify} messages.
         * @function encodeDelimited
         * @memberof languagecheck.OkResponse
         * @static
         * @param {languagecheck.OkResponse.$Properties} message OkResponse message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        OkResponse.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer && writer.len ? writer.fork() : writer).ldelim();
        };

        /**
         * Decodes an OkResponse message from the specified reader or buffer.
         * @function decode
         * @memberof languagecheck.OkResponse
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {languagecheck.OkResponse & languagecheck.OkResponse.$Shape} OkResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        OkResponse.decode = function decode(reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw Error("max depth exceeded");
            var end = length === undefined ? reader.len : reader.pos + length, message = _target || new $root.languagecheck.OkResponse();
            while (reader.pos < end) {
                var start = reader.pos;
                var tag = reader.tag();
                if (tag === _end) {
                    _end = undefined;
                    break;
                }
                reader.skipType(tag & 7, _depth, tag);
                $util.makeProp(message, "$unknowns", false);
                (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
            }
            if (_end !== undefined)
                throw Error("missing end group");
            return message;
        };

        /**
         * Decodes an OkResponse message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof languagecheck.OkResponse
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {languagecheck.OkResponse & languagecheck.OkResponse.$Shape} OkResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        OkResponse.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies an OkResponse message.
         * @function verify
         * @memberof languagecheck.OkResponse
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        OkResponse.verify = function verify(message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            return null;
        };

        /**
         * Creates an OkResponse message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof languagecheck.OkResponse
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {languagecheck.OkResponse} OkResponse
         */
        OkResponse.fromObject = function fromObject(object, _depth) {
            if (object instanceof $root.languagecheck.OkResponse)
                return object;
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            return new $root.languagecheck.OkResponse();
        };

        /**
         * Creates a plain object from an OkResponse message. Also converts values to other types if specified.
         * @function toObject
         * @memberof languagecheck.OkResponse
         * @static
         * @param {languagecheck.OkResponse} message OkResponse
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        OkResponse.toObject = function toObject() {
            return {};
        };

        /**
         * Converts this OkResponse to JSON.
         * @function toJSON
         * @memberof languagecheck.OkResponse
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        OkResponse.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the type url for OkResponse
         * @function getTypeUrl
         * @memberof languagecheck.OkResponse
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        OkResponse.getTypeUrl = function getTypeUrl(prefix) {
            if (prefix === undefined)
                prefix = "type.googleapis.com";
            return prefix + "/languagecheck.OkResponse";
        };

        return OkResponse;
    })();

    languagecheck.ErrorResponse = (function() {

        /**
         * Properties of an ErrorResponse.
         * @typedef {Object} languagecheck.ErrorResponse.$Properties
         * @property {string|null} [message] ErrorResponse message
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding
         */

        /**
         * Properties of an ErrorResponse.
         * @memberof languagecheck
         * @interface IErrorResponse
         * @augments languagecheck.ErrorResponse.$Properties
         * @deprecated Use languagecheck.ErrorResponse.$Properties instead.
         */

        /**
         * Shape of an ErrorResponse.
         * @typedef {languagecheck.ErrorResponse.$Properties} languagecheck.ErrorResponse.$Shape
         */

        /**
         * Constructs a new ErrorResponse.
         * @memberof languagecheck
         * @classdesc Represents an ErrorResponse.
         * @constructor
         * @param {languagecheck.ErrorResponse.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding
         */
        function ErrorResponse(properties) {
            if (properties)
                for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * ErrorResponse message.
         * @member {string} message
         * @memberof languagecheck.ErrorResponse
         * @instance
         */
        ErrorResponse.prototype.message = "";

        /**
         * Creates a new ErrorResponse instance using the specified properties.
         * @function create
         * @memberof languagecheck.ErrorResponse
         * @static
         * @param {languagecheck.ErrorResponse.$Properties=} [properties] Properties to set
         * @returns {languagecheck.ErrorResponse} ErrorResponse instance
         * @type {{
         *   (properties: languagecheck.ErrorResponse.$Shape): languagecheck.ErrorResponse & languagecheck.ErrorResponse.$Shape;
         *   (properties?: languagecheck.ErrorResponse.$Properties): languagecheck.ErrorResponse;
         * }}
         */
        ErrorResponse.create = function create(properties) {
            return new ErrorResponse(properties);
        };

        /**
         * Encodes the specified ErrorResponse message. Does not implicitly {@link languagecheck.ErrorResponse.verify|verify} messages.
         * @function encode
         * @memberof languagecheck.ErrorResponse
         * @static
         * @param {languagecheck.ErrorResponse.$Properties} message ErrorResponse message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        ErrorResponse.encode = function encode(message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            if (message.message != null && Object.hasOwnProperty.call(message, "message"))
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.message);
            if (message.$unknowns != null && Object.hasOwnProperty.call(message, "$unknowns"))
                for (var i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Encodes the specified ErrorResponse message, length delimited. Does not implicitly {@link languagecheck.ErrorResponse.verify|verify} messages.
         * @function encodeDelimited
         * @memberof languagecheck.ErrorResponse
         * @static
         * @param {languagecheck.ErrorResponse.$Properties} message ErrorResponse message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        ErrorResponse.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer && writer.len ? writer.fork() : writer).ldelim();
        };

        /**
         * Decodes an ErrorResponse message from the specified reader or buffer.
         * @function decode
         * @memberof languagecheck.ErrorResponse
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {languagecheck.ErrorResponse & languagecheck.ErrorResponse.$Shape} ErrorResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        ErrorResponse.decode = function decode(reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw Error("max depth exceeded");
            var end = length === undefined ? reader.len : reader.pos + length, message = _target || new $root.languagecheck.ErrorResponse(), value;
            while (reader.pos < end) {
                var start = reader.pos;
                var tag = reader.tag();
                if (tag === _end) {
                    _end = undefined;
                    break;
                }
                var wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.string()).length)
                            message.message = value;
                        else
                            delete message.message;
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                $util.makeProp(message, "$unknowns", false);
                (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
            }
            if (_end !== undefined)
                throw Error("missing end group");
            return message;
        };

        /**
         * Decodes an ErrorResponse message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof languagecheck.ErrorResponse
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {languagecheck.ErrorResponse & languagecheck.ErrorResponse.$Shape} ErrorResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        ErrorResponse.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies an ErrorResponse message.
         * @function verify
         * @memberof languagecheck.ErrorResponse
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        ErrorResponse.verify = function verify(message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (message.message != null && message.hasOwnProperty("message"))
                if (!$util.isString(message.message))
                    return "message: string expected";
            return null;
        };

        /**
         * Creates an ErrorResponse message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof languagecheck.ErrorResponse
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {languagecheck.ErrorResponse} ErrorResponse
         */
        ErrorResponse.fromObject = function fromObject(object, _depth) {
            if (object instanceof $root.languagecheck.ErrorResponse)
                return object;
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            var message = new $root.languagecheck.ErrorResponse();
            if (object.message != null)
                if (typeof object.message !== "string" || object.message.length)
                    message.message = String(object.message);
            return message;
        };

        /**
         * Creates a plain object from an ErrorResponse message. Also converts values to other types if specified.
         * @function toObject
         * @memberof languagecheck.ErrorResponse
         * @static
         * @param {languagecheck.ErrorResponse} message ErrorResponse
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        ErrorResponse.toObject = function toObject(message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            var object = {};
            if (options.defaults)
                object.message = "";
            if (message.message != null && message.hasOwnProperty("message"))
                object.message = message.message;
            return object;
        };

        /**
         * Converts this ErrorResponse to JSON.
         * @function toJSON
         * @memberof languagecheck.ErrorResponse
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        ErrorResponse.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the type url for ErrorResponse
         * @function getTypeUrl
         * @memberof languagecheck.ErrorResponse
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        ErrorResponse.getTypeUrl = function getTypeUrl(prefix) {
            if (prefix === undefined)
                prefix = "type.googleapis.com";
            return prefix + "/languagecheck.ErrorResponse";
        };

        return ErrorResponse;
    })();

    languagecheck.CheckerProvider = (function() {

        /**
         * Constructs a new CheckerProvider service.
         * @memberof languagecheck
         * @classdesc Represents a CheckerProvider
         * @extends $protobuf.rpc.Service
         * @constructor
         * @param {$protobuf.RPCImpl} rpcImpl RPC implementation
         * @param {boolean} [requestDelimited=false] Whether requests are length-delimited
         * @param {boolean} [responseDelimited=false] Whether responses are length-delimited
         */
        function CheckerProvider(rpcImpl, requestDelimited, responseDelimited) {
            $protobuf.rpc.Service.call(this, rpcImpl, requestDelimited, responseDelimited);
        }

        (CheckerProvider.prototype = Object.create($protobuf.rpc.Service.prototype)).constructor = CheckerProvider;

        /**
         * Creates new CheckerProvider service using the specified rpc implementation.
         * @function create
         * @memberof languagecheck.CheckerProvider
         * @static
         * @param {$protobuf.RPCImpl} rpcImpl RPC implementation
         * @param {boolean} [requestDelimited=false] Whether requests are length-delimited
         * @param {boolean} [responseDelimited=false] Whether responses are length-delimited
         * @returns {CheckerProvider} RPC service. Useful where requests and/or responses are streamed.
         */
        CheckerProvider.create = function create(rpcImpl, requestDelimited, responseDelimited) {
            return new this(rpcImpl, requestDelimited, responseDelimited);
        };

        /**
         * Callback as used by {@link languagecheck.CheckerProvider#checkProse}.
         * @memberof languagecheck.CheckerProvider
         * @typedef CheckProseCallback
         * @type {function}
         * @param {Error|null} error Error, if any
         * @param {languagecheck.CheckResponse} [response] CheckResponse
         */

        /**
         * Calls CheckProse.
         * @function checkProse
         * @memberof languagecheck.CheckerProvider
         * @instance
         * @param {languagecheck.ICheckRequest} request CheckRequest message or plain object
         * @param {languagecheck.CheckerProvider.CheckProseCallback} callback Node-style callback called with the error, if any, and CheckResponse
         * @returns {undefined}
         * @variation 1
         */
        Object.defineProperty(CheckerProvider.prototype.checkProse = function checkProse(request, callback) {
            return this.rpcCall(checkProse, $root.languagecheck.CheckRequest, $root.languagecheck.CheckResponse, request, callback);
        }, "name", { value: "CheckProse" });

        /**
         * Calls CheckProse.
         * @function checkProse
         * @memberof languagecheck.CheckerProvider
         * @instance
         * @param {languagecheck.ICheckRequest} request CheckRequest message or plain object
         * @returns {Promise<languagecheck.CheckResponse>} Promise
         * @variation 2
         */

        /**
         * Callback as used by {@link languagecheck.CheckerProvider#getMetadata}.
         * @memberof languagecheck.CheckerProvider
         * @typedef GetMetadataCallback
         * @type {function}
         * @param {Error|null} error Error, if any
         * @param {languagecheck.MetadataResponse} [response] MetadataResponse
         */

        /**
         * Calls GetMetadata.
         * @function getMetadata
         * @memberof languagecheck.CheckerProvider
         * @instance
         * @param {languagecheck.IMetadataRequest} request MetadataRequest message or plain object
         * @param {languagecheck.CheckerProvider.GetMetadataCallback} callback Node-style callback called with the error, if any, and MetadataResponse
         * @returns {undefined}
         * @variation 1
         */
        Object.defineProperty(CheckerProvider.prototype.getMetadata = function getMetadata(request, callback) {
            return this.rpcCall(getMetadata, $root.languagecheck.MetadataRequest, $root.languagecheck.MetadataResponse, request, callback);
        }, "name", { value: "GetMetadata" });

        /**
         * Calls GetMetadata.
         * @function getMetadata
         * @memberof languagecheck.CheckerProvider
         * @instance
         * @param {languagecheck.IMetadataRequest} request MetadataRequest message or plain object
         * @returns {Promise<languagecheck.MetadataResponse>} Promise
         * @variation 2
         */

        return CheckerProvider;
    })();

    languagecheck.CheckRequest = (function() {

        /**
         * Properties of a CheckRequest.
         * @typedef {Object} languagecheck.CheckRequest.$Properties
         * @property {string|null} [text] CheckRequest text
         * @property {string|null} [languageId] CheckRequest languageId
         * @property {Object.<string,string>|null} [settings] CheckRequest settings
         * @property {string|null} [filePath] CheckRequest filePath
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding
         */

        /**
         * Properties of a CheckRequest.
         * @memberof languagecheck
         * @interface ICheckRequest
         * @augments languagecheck.CheckRequest.$Properties
         * @deprecated Use languagecheck.CheckRequest.$Properties instead.
         */

        /**
         * Shape of a CheckRequest.
         * @typedef {languagecheck.CheckRequest.$Properties} languagecheck.CheckRequest.$Shape
         */

        /**
         * Constructs a new CheckRequest.
         * @memberof languagecheck
         * @classdesc Represents a CheckRequest.
         * @constructor
         * @param {languagecheck.CheckRequest.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding
         */
        function CheckRequest(properties) {
            this.settings = {};
            if (properties)
                for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * CheckRequest text.
         * @member {string} text
         * @memberof languagecheck.CheckRequest
         * @instance
         */
        CheckRequest.prototype.text = "";

        /**
         * CheckRequest languageId.
         * @member {string} languageId
         * @memberof languagecheck.CheckRequest
         * @instance
         */
        CheckRequest.prototype.languageId = "";

        /**
         * CheckRequest settings.
         * @member {Object.<string,string>} settings
         * @memberof languagecheck.CheckRequest
         * @instance
         */
        CheckRequest.prototype.settings = $util.emptyObject;

        /**
         * CheckRequest filePath.
         * @member {string|null|undefined} filePath
         * @memberof languagecheck.CheckRequest
         * @instance
         */
        CheckRequest.prototype.filePath = null;

        // OneOf field names bound to virtual getters and setters
        var $oneOfFields;

        // Virtual OneOf for proto3 optional field
        Object.defineProperty(CheckRequest.prototype, "_filePath", {
            get: $util.oneOfGetter($oneOfFields = ["filePath"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        /**
         * Creates a new CheckRequest instance using the specified properties.
         * @function create
         * @memberof languagecheck.CheckRequest
         * @static
         * @param {languagecheck.CheckRequest.$Properties=} [properties] Properties to set
         * @returns {languagecheck.CheckRequest} CheckRequest instance
         * @type {{
         *   (properties: languagecheck.CheckRequest.$Shape): languagecheck.CheckRequest & languagecheck.CheckRequest.$Shape;
         *   (properties?: languagecheck.CheckRequest.$Properties): languagecheck.CheckRequest;
         * }}
         */
        CheckRequest.create = function create(properties) {
            return new CheckRequest(properties);
        };

        /**
         * Encodes the specified CheckRequest message. Does not implicitly {@link languagecheck.CheckRequest.verify|verify} messages.
         * @function encode
         * @memberof languagecheck.CheckRequest
         * @static
         * @param {languagecheck.CheckRequest.$Properties} message CheckRequest message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        CheckRequest.encode = function encode(message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            if (message.text != null && Object.hasOwnProperty.call(message, "text"))
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.text);
            if (message.languageId != null && Object.hasOwnProperty.call(message, "languageId"))
                writer.uint32(/* id 2, wireType 2 =*/18).string(message.languageId);
            if (message.settings != null && Object.hasOwnProperty.call(message, "settings"))
                for (var keys = Object.keys(message.settings), i = 0; i < keys.length; ++i)
                    writer.uint32(/* id 3, wireType 2 =*/26).fork().uint32(/* id 1, wireType 2 =*/10).string(keys[i]).uint32(/* id 2, wireType 2 =*/18).string(message.settings[keys[i]]).ldelim();
            if (message.filePath != null && Object.hasOwnProperty.call(message, "filePath"))
                writer.uint32(/* id 4, wireType 2 =*/34).string(message.filePath);
            if (message.$unknowns != null && Object.hasOwnProperty.call(message, "$unknowns"))
                for (var i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Encodes the specified CheckRequest message, length delimited. Does not implicitly {@link languagecheck.CheckRequest.verify|verify} messages.
         * @function encodeDelimited
         * @memberof languagecheck.CheckRequest
         * @static
         * @param {languagecheck.CheckRequest.$Properties} message CheckRequest message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        CheckRequest.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer && writer.len ? writer.fork() : writer).ldelim();
        };

        /**
         * Decodes a CheckRequest message from the specified reader or buffer.
         * @function decode
         * @memberof languagecheck.CheckRequest
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {languagecheck.CheckRequest & languagecheck.CheckRequest.$Shape} CheckRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        CheckRequest.decode = function decode(reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw Error("max depth exceeded");
            var end = length === undefined ? reader.len : reader.pos + length, message = _target || new $root.languagecheck.CheckRequest(), key, value;
            while (reader.pos < end) {
                var start = reader.pos;
                var tag = reader.tag();
                if (tag === _end) {
                    _end = undefined;
                    break;
                }
                var wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.string()).length)
                            message.text = value;
                        else
                            delete message.text;
                        continue;
                    }
                case 2: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.string()).length)
                            message.languageId = value;
                        else
                            delete message.languageId;
                        continue;
                    }
                case 3: {
                        if (wireType !== 2)
                            break;
                        if (message.settings === $util.emptyObject)
                            message.settings = {};
                        var end2 = reader.uint32() + reader.pos;
                        key = "";
                        value = "";
                        while (reader.pos < end2) {
                            var tag2 = reader.tag();
                            wireType = tag2 & 7;
                            switch (tag2 >>>= 3) {
                            case 1:
                                if (wireType !== 2)
                                    break;
                                key = reader.string();
                                continue;
                            case 2:
                                if (wireType !== 2)
                                    break;
                                value = reader.string();
                                continue;
                            }
                            reader.skipType(wireType, _depth, tag2);
                        }
                        if (key === "__proto__")
                            $util.makeProp(message.settings, key);
                        message.settings[key] = value;
                        continue;
                    }
                case 4: {
                        if (wireType !== 2)
                            break;
                        message.filePath = reader.string();
                        message._filePath = "filePath";
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                $util.makeProp(message, "$unknowns", false);
                (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
            }
            if (_end !== undefined)
                throw Error("missing end group");
            return message;
        };

        /**
         * Decodes a CheckRequest message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof languagecheck.CheckRequest
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {languagecheck.CheckRequest & languagecheck.CheckRequest.$Shape} CheckRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        CheckRequest.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a CheckRequest message.
         * @function verify
         * @memberof languagecheck.CheckRequest
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        CheckRequest.verify = function verify(message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            var properties = {};
            if (message.text != null && message.hasOwnProperty("text"))
                if (!$util.isString(message.text))
                    return "text: string expected";
            if (message.languageId != null && message.hasOwnProperty("languageId"))
                if (!$util.isString(message.languageId))
                    return "languageId: string expected";
            if (message.settings != null && message.hasOwnProperty("settings")) {
                if (!$util.isObject(message.settings))
                    return "settings: object expected";
                var key = Object.keys(message.settings);
                for (var i = 0; i < key.length; ++i)
                    if (!$util.isString(message.settings[key[i]]))
                        return "settings: string{k:string} expected";
            }
            if (message.filePath != null && message.hasOwnProperty("filePath")) {
                properties._filePath = 1;
                if (!$util.isString(message.filePath))
                    return "filePath: string expected";
            }
            return null;
        };

        /**
         * Creates a CheckRequest message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof languagecheck.CheckRequest
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {languagecheck.CheckRequest} CheckRequest
         */
        CheckRequest.fromObject = function fromObject(object, _depth) {
            if (object instanceof $root.languagecheck.CheckRequest)
                return object;
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            var message = new $root.languagecheck.CheckRequest();
            if (object.text != null)
                if (typeof object.text !== "string" || object.text.length)
                    message.text = String(object.text);
            if (object.languageId != null)
                if (typeof object.languageId !== "string" || object.languageId.length)
                    message.languageId = String(object.languageId);
            if (object.settings) {
                if (typeof object.settings !== "object")
                    throw TypeError(".languagecheck.CheckRequest.settings: object expected");
                message.settings = {};
                for (var keys = Object.keys(object.settings), i = 0; i < keys.length; ++i) {
                    if (keys[i] === "__proto__")
                        $util.makeProp(message.settings, keys[i]);
                    message.settings[keys[i]] = String(object.settings[keys[i]]);
                }
            }
            if (object.filePath != null)
                message.filePath = String(object.filePath);
            return message;
        };

        /**
         * Creates a plain object from a CheckRequest message. Also converts values to other types if specified.
         * @function toObject
         * @memberof languagecheck.CheckRequest
         * @static
         * @param {languagecheck.CheckRequest} message CheckRequest
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        CheckRequest.toObject = function toObject(message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            var object = {};
            if (options.objects || options.defaults)
                object.settings = {};
            if (options.defaults) {
                object.text = "";
                object.languageId = "";
            }
            if (message.text != null && message.hasOwnProperty("text"))
                object.text = message.text;
            if (message.languageId != null && message.hasOwnProperty("languageId"))
                object.languageId = message.languageId;
            var keys2;
            if (message.settings && (keys2 = Object.keys(message.settings)).length) {
                object.settings = {};
                for (var j = 0; j < keys2.length; ++j) {
                    if (keys2[j] === "__proto__")
                        $util.makeProp(object.settings, keys2[j]);
                    object.settings[keys2[j]] = message.settings[keys2[j]];
                }
            }
            if (message.filePath != null && message.hasOwnProperty("filePath"))
                object.filePath = message.filePath;
            return object;
        };

        /**
         * Converts this CheckRequest to JSON.
         * @function toJSON
         * @memberof languagecheck.CheckRequest
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        CheckRequest.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the type url for CheckRequest
         * @function getTypeUrl
         * @memberof languagecheck.CheckRequest
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        CheckRequest.getTypeUrl = function getTypeUrl(prefix) {
            if (prefix === undefined)
                prefix = "type.googleapis.com";
            return prefix + "/languagecheck.CheckRequest";
        };

        return CheckRequest;
    })();

    languagecheck.CheckResponse = (function() {

        /**
         * Properties of a CheckResponse.
         * @typedef {Object} languagecheck.CheckResponse.$Properties
         * @property {Array.<languagecheck.Diagnostic.$Properties>|null} [diagnostics] CheckResponse diagnostics
         * @property {languagecheck.ExtractionInfo.$Properties|null} [extraction] CheckResponse extraction
         * @property {Array.<languagecheck.EngineHealth.$Properties>|null} [engineHealth] CheckResponse engineHealth
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding
         */

        /**
         * Properties of a CheckResponse.
         * @memberof languagecheck
         * @interface ICheckResponse
         * @augments languagecheck.CheckResponse.$Properties
         * @deprecated Use languagecheck.CheckResponse.$Properties instead.
         */

        /**
         * Shape of a CheckResponse.
         * @typedef {languagecheck.CheckResponse.$Properties} languagecheck.CheckResponse.$Shape
         */

        /**
         * Constructs a new CheckResponse.
         * @memberof languagecheck
         * @classdesc Represents a CheckResponse.
         * @constructor
         * @param {languagecheck.CheckResponse.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding
         */
        function CheckResponse(properties) {
            this.diagnostics = [];
            this.engineHealth = [];
            if (properties)
                for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * CheckResponse diagnostics.
         * @member {Array.<languagecheck.Diagnostic.$Properties>} diagnostics
         * @memberof languagecheck.CheckResponse
         * @instance
         */
        CheckResponse.prototype.diagnostics = $util.emptyArray;

        /**
         * CheckResponse extraction.
         * @member {languagecheck.ExtractionInfo.$Properties|null|undefined} extraction
         * @memberof languagecheck.CheckResponse
         * @instance
         */
        CheckResponse.prototype.extraction = null;

        /**
         * CheckResponse engineHealth.
         * @member {Array.<languagecheck.EngineHealth.$Properties>} engineHealth
         * @memberof languagecheck.CheckResponse
         * @instance
         */
        CheckResponse.prototype.engineHealth = $util.emptyArray;

        /**
         * Creates a new CheckResponse instance using the specified properties.
         * @function create
         * @memberof languagecheck.CheckResponse
         * @static
         * @param {languagecheck.CheckResponse.$Properties=} [properties] Properties to set
         * @returns {languagecheck.CheckResponse} CheckResponse instance
         * @type {{
         *   (properties: languagecheck.CheckResponse.$Shape): languagecheck.CheckResponse & languagecheck.CheckResponse.$Shape;
         *   (properties?: languagecheck.CheckResponse.$Properties): languagecheck.CheckResponse;
         * }}
         */
        CheckResponse.create = function create(properties) {
            return new CheckResponse(properties);
        };

        /**
         * Encodes the specified CheckResponse message. Does not implicitly {@link languagecheck.CheckResponse.verify|verify} messages.
         * @function encode
         * @memberof languagecheck.CheckResponse
         * @static
         * @param {languagecheck.CheckResponse.$Properties} message CheckResponse message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        CheckResponse.encode = function encode(message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            if (message.diagnostics != null && message.diagnostics.length)
                for (var i = 0; i < message.diagnostics.length; ++i)
                    $root.languagecheck.Diagnostic.encode(message.diagnostics[i], writer.uint32(/* id 1, wireType 2 =*/10).fork(), _depth + 1).ldelim();
            if (message.extraction != null && Object.hasOwnProperty.call(message, "extraction"))
                $root.languagecheck.ExtractionInfo.encode(message.extraction, writer.uint32(/* id 2, wireType 2 =*/18).fork(), _depth + 1).ldelim();
            if (message.engineHealth != null && message.engineHealth.length)
                for (var i = 0; i < message.engineHealth.length; ++i)
                    $root.languagecheck.EngineHealth.encode(message.engineHealth[i], writer.uint32(/* id 3, wireType 2 =*/26).fork(), _depth + 1).ldelim();
            if (message.$unknowns != null && Object.hasOwnProperty.call(message, "$unknowns"))
                for (var i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Encodes the specified CheckResponse message, length delimited. Does not implicitly {@link languagecheck.CheckResponse.verify|verify} messages.
         * @function encodeDelimited
         * @memberof languagecheck.CheckResponse
         * @static
         * @param {languagecheck.CheckResponse.$Properties} message CheckResponse message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        CheckResponse.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer && writer.len ? writer.fork() : writer).ldelim();
        };

        /**
         * Decodes a CheckResponse message from the specified reader or buffer.
         * @function decode
         * @memberof languagecheck.CheckResponse
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {languagecheck.CheckResponse & languagecheck.CheckResponse.$Shape} CheckResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        CheckResponse.decode = function decode(reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw Error("max depth exceeded");
            var end = length === undefined ? reader.len : reader.pos + length, message = _target || new $root.languagecheck.CheckResponse(), value;
            while (reader.pos < end) {
                var start = reader.pos;
                var tag = reader.tag();
                if (tag === _end) {
                    _end = undefined;
                    break;
                }
                var wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 2)
                            break;
                        if (!(message.diagnostics && message.diagnostics.length))
                            message.diagnostics = [];
                        message.diagnostics.push($root.languagecheck.Diagnostic.decode(reader, reader.uint32(), undefined, _depth + 1));
                        continue;
                    }
                case 2: {
                        if (wireType !== 2)
                            break;
                        message.extraction = $root.languagecheck.ExtractionInfo.decode(reader, reader.uint32(), undefined, _depth + 1, message.extraction);
                        continue;
                    }
                case 3: {
                        if (wireType !== 2)
                            break;
                        if (!(message.engineHealth && message.engineHealth.length))
                            message.engineHealth = [];
                        message.engineHealth.push($root.languagecheck.EngineHealth.decode(reader, reader.uint32(), undefined, _depth + 1));
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                $util.makeProp(message, "$unknowns", false);
                (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
            }
            if (_end !== undefined)
                throw Error("missing end group");
            return message;
        };

        /**
         * Decodes a CheckResponse message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof languagecheck.CheckResponse
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {languagecheck.CheckResponse & languagecheck.CheckResponse.$Shape} CheckResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        CheckResponse.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a CheckResponse message.
         * @function verify
         * @memberof languagecheck.CheckResponse
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        CheckResponse.verify = function verify(message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (message.diagnostics != null && message.hasOwnProperty("diagnostics")) {
                if (!Array.isArray(message.diagnostics))
                    return "diagnostics: array expected";
                for (var i = 0; i < message.diagnostics.length; ++i) {
                    var error = $root.languagecheck.Diagnostic.verify(message.diagnostics[i], _depth + 1);
                    if (error)
                        return "diagnostics." + error;
                }
            }
            if (message.extraction != null && message.hasOwnProperty("extraction")) {
                var error = $root.languagecheck.ExtractionInfo.verify(message.extraction, _depth + 1);
                if (error)
                    return "extraction." + error;
            }
            if (message.engineHealth != null && message.hasOwnProperty("engineHealth")) {
                if (!Array.isArray(message.engineHealth))
                    return "engineHealth: array expected";
                for (var i = 0; i < message.engineHealth.length; ++i) {
                    var error = $root.languagecheck.EngineHealth.verify(message.engineHealth[i], _depth + 1);
                    if (error)
                        return "engineHealth." + error;
                }
            }
            return null;
        };

        /**
         * Creates a CheckResponse message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof languagecheck.CheckResponse
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {languagecheck.CheckResponse} CheckResponse
         */
        CheckResponse.fromObject = function fromObject(object, _depth) {
            if (object instanceof $root.languagecheck.CheckResponse)
                return object;
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            var message = new $root.languagecheck.CheckResponse();
            if (object.diagnostics) {
                if (!Array.isArray(object.diagnostics))
                    throw TypeError(".languagecheck.CheckResponse.diagnostics: array expected");
                message.diagnostics = Array(object.diagnostics.length);
                for (var i = 0; i < object.diagnostics.length; ++i) {
                    if (typeof object.diagnostics[i] !== "object")
                        throw TypeError(".languagecheck.CheckResponse.diagnostics: object expected");
                    message.diagnostics[i] = $root.languagecheck.Diagnostic.fromObject(object.diagnostics[i], _depth + 1);
                }
            }
            if (object.extraction != null) {
                if (typeof object.extraction !== "object")
                    throw TypeError(".languagecheck.CheckResponse.extraction: object expected");
                message.extraction = $root.languagecheck.ExtractionInfo.fromObject(object.extraction, _depth + 1);
            }
            if (object.engineHealth) {
                if (!Array.isArray(object.engineHealth))
                    throw TypeError(".languagecheck.CheckResponse.engineHealth: array expected");
                message.engineHealth = Array(object.engineHealth.length);
                for (var i = 0; i < object.engineHealth.length; ++i) {
                    if (typeof object.engineHealth[i] !== "object")
                        throw TypeError(".languagecheck.CheckResponse.engineHealth: object expected");
                    message.engineHealth[i] = $root.languagecheck.EngineHealth.fromObject(object.engineHealth[i], _depth + 1);
                }
            }
            return message;
        };

        /**
         * Creates a plain object from a CheckResponse message. Also converts values to other types if specified.
         * @function toObject
         * @memberof languagecheck.CheckResponse
         * @static
         * @param {languagecheck.CheckResponse} message CheckResponse
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        CheckResponse.toObject = function toObject(message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            var object = {};
            if (options.arrays || options.defaults) {
                object.diagnostics = [];
                object.engineHealth = [];
            }
            if (options.defaults)
                object.extraction = null;
            if (message.diagnostics && message.diagnostics.length) {
                object.diagnostics = Array(message.diagnostics.length);
                for (var j = 0; j < message.diagnostics.length; ++j)
                    object.diagnostics[j] = $root.languagecheck.Diagnostic.toObject(message.diagnostics[j], options, _depth + 1);
            }
            if (message.extraction != null && message.hasOwnProperty("extraction"))
                object.extraction = $root.languagecheck.ExtractionInfo.toObject(message.extraction, options, _depth + 1);
            if (message.engineHealth && message.engineHealth.length) {
                object.engineHealth = Array(message.engineHealth.length);
                for (var j = 0; j < message.engineHealth.length; ++j)
                    object.engineHealth[j] = $root.languagecheck.EngineHealth.toObject(message.engineHealth[j], options, _depth + 1);
            }
            return object;
        };

        /**
         * Converts this CheckResponse to JSON.
         * @function toJSON
         * @memberof languagecheck.CheckResponse
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        CheckResponse.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the type url for CheckResponse
         * @function getTypeUrl
         * @memberof languagecheck.CheckResponse
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        CheckResponse.getTypeUrl = function getTypeUrl(prefix) {
            if (prefix === undefined)
                prefix = "type.googleapis.com";
            return prefix + "/languagecheck.CheckResponse";
        };

        return CheckResponse;
    })();

    languagecheck.EngineHealth = (function() {

        /**
         * Properties of an EngineHealth.
         * @typedef {Object} languagecheck.EngineHealth.$Properties
         * @property {string|null} [name] EngineHealth name
         * @property {string|null} [status] EngineHealth status
         * @property {number|null} [consecutiveFailures] EngineHealth consecutiveFailures
         * @property {string|null} [lastError] EngineHealth lastError
         * @property {number|Long|null} [lastSuccessEpochMs] EngineHealth lastSuccessEpochMs
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding
         */

        /**
         * Properties of an EngineHealth.
         * @memberof languagecheck
         * @interface IEngineHealth
         * @augments languagecheck.EngineHealth.$Properties
         * @deprecated Use languagecheck.EngineHealth.$Properties instead.
         */

        /**
         * Shape of an EngineHealth.
         * @typedef {languagecheck.EngineHealth.$Properties} languagecheck.EngineHealth.$Shape
         */

        /**
         * Constructs a new EngineHealth.
         * @memberof languagecheck
         * @classdesc Represents an EngineHealth.
         * @constructor
         * @param {languagecheck.EngineHealth.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding
         */
        function EngineHealth(properties) {
            if (properties)
                for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * EngineHealth name.
         * @member {string} name
         * @memberof languagecheck.EngineHealth
         * @instance
         */
        EngineHealth.prototype.name = "";

        /**
         * EngineHealth status.
         * @member {string} status
         * @memberof languagecheck.EngineHealth
         * @instance
         */
        EngineHealth.prototype.status = "";

        /**
         * EngineHealth consecutiveFailures.
         * @member {number} consecutiveFailures
         * @memberof languagecheck.EngineHealth
         * @instance
         */
        EngineHealth.prototype.consecutiveFailures = 0;

        /**
         * EngineHealth lastError.
         * @member {string} lastError
         * @memberof languagecheck.EngineHealth
         * @instance
         */
        EngineHealth.prototype.lastError = "";

        /**
         * EngineHealth lastSuccessEpochMs.
         * @member {number|Long} lastSuccessEpochMs
         * @memberof languagecheck.EngineHealth
         * @instance
         */
        EngineHealth.prototype.lastSuccessEpochMs = $util.Long ? $util.Long.fromBits(0,0,true) : 0;

        /**
         * Creates a new EngineHealth instance using the specified properties.
         * @function create
         * @memberof languagecheck.EngineHealth
         * @static
         * @param {languagecheck.EngineHealth.$Properties=} [properties] Properties to set
         * @returns {languagecheck.EngineHealth} EngineHealth instance
         * @type {{
         *   (properties: languagecheck.EngineHealth.$Shape): languagecheck.EngineHealth & languagecheck.EngineHealth.$Shape;
         *   (properties?: languagecheck.EngineHealth.$Properties): languagecheck.EngineHealth;
         * }}
         */
        EngineHealth.create = function create(properties) {
            return new EngineHealth(properties);
        };

        /**
         * Encodes the specified EngineHealth message. Does not implicitly {@link languagecheck.EngineHealth.verify|verify} messages.
         * @function encode
         * @memberof languagecheck.EngineHealth
         * @static
         * @param {languagecheck.EngineHealth.$Properties} message EngineHealth message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        EngineHealth.encode = function encode(message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            if (message.name != null && Object.hasOwnProperty.call(message, "name"))
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.name);
            if (message.status != null && Object.hasOwnProperty.call(message, "status"))
                writer.uint32(/* id 2, wireType 2 =*/18).string(message.status);
            if (message.consecutiveFailures != null && Object.hasOwnProperty.call(message, "consecutiveFailures"))
                writer.uint32(/* id 3, wireType 0 =*/24).uint32(message.consecutiveFailures);
            if (message.lastError != null && Object.hasOwnProperty.call(message, "lastError"))
                writer.uint32(/* id 4, wireType 2 =*/34).string(message.lastError);
            if (message.lastSuccessEpochMs != null && Object.hasOwnProperty.call(message, "lastSuccessEpochMs"))
                writer.uint32(/* id 5, wireType 0 =*/40).uint64(message.lastSuccessEpochMs);
            if (message.$unknowns != null && Object.hasOwnProperty.call(message, "$unknowns"))
                for (var i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Encodes the specified EngineHealth message, length delimited. Does not implicitly {@link languagecheck.EngineHealth.verify|verify} messages.
         * @function encodeDelimited
         * @memberof languagecheck.EngineHealth
         * @static
         * @param {languagecheck.EngineHealth.$Properties} message EngineHealth message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        EngineHealth.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer && writer.len ? writer.fork() : writer).ldelim();
        };

        /**
         * Decodes an EngineHealth message from the specified reader or buffer.
         * @function decode
         * @memberof languagecheck.EngineHealth
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {languagecheck.EngineHealth & languagecheck.EngineHealth.$Shape} EngineHealth
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        EngineHealth.decode = function decode(reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw Error("max depth exceeded");
            var end = length === undefined ? reader.len : reader.pos + length, message = _target || new $root.languagecheck.EngineHealth(), value;
            while (reader.pos < end) {
                var start = reader.pos;
                var tag = reader.tag();
                if (tag === _end) {
                    _end = undefined;
                    break;
                }
                var wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.string()).length)
                            message.name = value;
                        else
                            delete message.name;
                        continue;
                    }
                case 2: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.string()).length)
                            message.status = value;
                        else
                            delete message.status;
                        continue;
                    }
                case 3: {
                        if (wireType !== 0)
                            break;
                        if (value = reader.uint32())
                            message.consecutiveFailures = value;
                        else
                            delete message.consecutiveFailures;
                        continue;
                    }
                case 4: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.string()).length)
                            message.lastError = value;
                        else
                            delete message.lastError;
                        continue;
                    }
                case 5: {
                        if (wireType !== 0)
                            break;
                        if (typeof (value = reader.uint64()) === "object" ? value.low || value.high : value !== 0)
                            message.lastSuccessEpochMs = value;
                        else
                            delete message.lastSuccessEpochMs;
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                $util.makeProp(message, "$unknowns", false);
                (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
            }
            if (_end !== undefined)
                throw Error("missing end group");
            return message;
        };

        /**
         * Decodes an EngineHealth message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof languagecheck.EngineHealth
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {languagecheck.EngineHealth & languagecheck.EngineHealth.$Shape} EngineHealth
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        EngineHealth.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies an EngineHealth message.
         * @function verify
         * @memberof languagecheck.EngineHealth
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        EngineHealth.verify = function verify(message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (message.name != null && message.hasOwnProperty("name"))
                if (!$util.isString(message.name))
                    return "name: string expected";
            if (message.status != null && message.hasOwnProperty("status"))
                if (!$util.isString(message.status))
                    return "status: string expected";
            if (message.consecutiveFailures != null && message.hasOwnProperty("consecutiveFailures"))
                if (!$util.isInteger(message.consecutiveFailures))
                    return "consecutiveFailures: integer expected";
            if (message.lastError != null && message.hasOwnProperty("lastError"))
                if (!$util.isString(message.lastError))
                    return "lastError: string expected";
            if (message.lastSuccessEpochMs != null && message.hasOwnProperty("lastSuccessEpochMs"))
                if (!$util.isInteger(message.lastSuccessEpochMs) && !(message.lastSuccessEpochMs && $util.isInteger(message.lastSuccessEpochMs.low) && $util.isInteger(message.lastSuccessEpochMs.high)))
                    return "lastSuccessEpochMs: integer|Long expected";
            return null;
        };

        /**
         * Creates an EngineHealth message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof languagecheck.EngineHealth
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {languagecheck.EngineHealth} EngineHealth
         */
        EngineHealth.fromObject = function fromObject(object, _depth) {
            if (object instanceof $root.languagecheck.EngineHealth)
                return object;
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            var message = new $root.languagecheck.EngineHealth();
            if (object.name != null)
                if (typeof object.name !== "string" || object.name.length)
                    message.name = String(object.name);
            if (object.status != null)
                if (typeof object.status !== "string" || object.status.length)
                    message.status = String(object.status);
            if (object.consecutiveFailures != null)
                if (Number(object.consecutiveFailures) !== 0)
                    message.consecutiveFailures = object.consecutiveFailures >>> 0;
            if (object.lastError != null)
                if (typeof object.lastError !== "string" || object.lastError.length)
                    message.lastError = String(object.lastError);
            if (object.lastSuccessEpochMs != null)
                if (typeof object.lastSuccessEpochMs === "object" ? object.lastSuccessEpochMs.low || object.lastSuccessEpochMs.high : Number(object.lastSuccessEpochMs) !== 0)
                    if ($util.Long)
                        message.lastSuccessEpochMs = $util.Long.fromValue(object.lastSuccessEpochMs, true);
                    else if (typeof object.lastSuccessEpochMs === "string")
                        message.lastSuccessEpochMs = parseInt(object.lastSuccessEpochMs, 10);
                    else if (typeof object.lastSuccessEpochMs === "number")
                        message.lastSuccessEpochMs = object.lastSuccessEpochMs;
                    else if (typeof object.lastSuccessEpochMs === "object")
                        message.lastSuccessEpochMs = new $util.LongBits(object.lastSuccessEpochMs.low >>> 0, object.lastSuccessEpochMs.high >>> 0).toNumber(true);
            return message;
        };

        /**
         * Creates a plain object from an EngineHealth message. Also converts values to other types if specified.
         * @function toObject
         * @memberof languagecheck.EngineHealth
         * @static
         * @param {languagecheck.EngineHealth} message EngineHealth
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        EngineHealth.toObject = function toObject(message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            var object = {};
            if (options.defaults) {
                object.name = "";
                object.status = "";
                object.consecutiveFailures = 0;
                object.lastError = "";
                if ($util.Long) {
                    var long = new $util.Long(0, 0, true);
                    object.lastSuccessEpochMs = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : typeof BigInt !== "undefined" && options.longs === BigInt ? long.toBigInt() : long;
                } else
                    object.lastSuccessEpochMs = options.longs === String ? "0" : typeof BigInt !== "undefined" && options.longs === BigInt ? BigInt("0") : 0;
            }
            if (message.name != null && message.hasOwnProperty("name"))
                object.name = message.name;
            if (message.status != null && message.hasOwnProperty("status"))
                object.status = message.status;
            if (message.consecutiveFailures != null && message.hasOwnProperty("consecutiveFailures"))
                object.consecutiveFailures = message.consecutiveFailures;
            if (message.lastError != null && message.hasOwnProperty("lastError"))
                object.lastError = message.lastError;
            if (message.lastSuccessEpochMs != null && message.hasOwnProperty("lastSuccessEpochMs"))
                if (typeof BigInt !== "undefined" && options.longs === BigInt)
                    object.lastSuccessEpochMs = typeof message.lastSuccessEpochMs === "number" ? BigInt(message.lastSuccessEpochMs) : $util.Long.fromBits(message.lastSuccessEpochMs.low >>> 0, message.lastSuccessEpochMs.high >>> 0, true).toBigInt();
                else if (typeof message.lastSuccessEpochMs === "number")
                    object.lastSuccessEpochMs = options.longs === String ? String(message.lastSuccessEpochMs) : message.lastSuccessEpochMs;
                else
                    object.lastSuccessEpochMs = options.longs === String ? $util.Long.prototype.toString.call(message.lastSuccessEpochMs) : options.longs === Number ? new $util.LongBits(message.lastSuccessEpochMs.low >>> 0, message.lastSuccessEpochMs.high >>> 0).toNumber(true) : message.lastSuccessEpochMs;
            return object;
        };

        /**
         * Converts this EngineHealth to JSON.
         * @function toJSON
         * @memberof languagecheck.EngineHealth
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        EngineHealth.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the type url for EngineHealth
         * @function getTypeUrl
         * @memberof languagecheck.EngineHealth
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        EngineHealth.getTypeUrl = function getTypeUrl(prefix) {
            if (prefix === undefined)
                prefix = "type.googleapis.com";
            return prefix + "/languagecheck.EngineHealth";
        };

        return EngineHealth;
    })();

    languagecheck.ExtractionExclusion = (function() {

        /**
         * Properties of an ExtractionExclusion.
         * @typedef {Object} languagecheck.ExtractionExclusion.$Properties
         * @property {number|null} [startByte] ExtractionExclusion startByte
         * @property {number|null} [endByte] ExtractionExclusion endByte
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding
         */

        /**
         * Properties of an ExtractionExclusion.
         * @memberof languagecheck
         * @interface IExtractionExclusion
         * @augments languagecheck.ExtractionExclusion.$Properties
         * @deprecated Use languagecheck.ExtractionExclusion.$Properties instead.
         */

        /**
         * Shape of an ExtractionExclusion.
         * @typedef {languagecheck.ExtractionExclusion.$Properties} languagecheck.ExtractionExclusion.$Shape
         */

        /**
         * Constructs a new ExtractionExclusion.
         * @memberof languagecheck
         * @classdesc Represents an ExtractionExclusion.
         * @constructor
         * @param {languagecheck.ExtractionExclusion.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding
         */
        function ExtractionExclusion(properties) {
            if (properties)
                for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * ExtractionExclusion startByte.
         * @member {number} startByte
         * @memberof languagecheck.ExtractionExclusion
         * @instance
         */
        ExtractionExclusion.prototype.startByte = 0;

        /**
         * ExtractionExclusion endByte.
         * @member {number} endByte
         * @memberof languagecheck.ExtractionExclusion
         * @instance
         */
        ExtractionExclusion.prototype.endByte = 0;

        /**
         * Creates a new ExtractionExclusion instance using the specified properties.
         * @function create
         * @memberof languagecheck.ExtractionExclusion
         * @static
         * @param {languagecheck.ExtractionExclusion.$Properties=} [properties] Properties to set
         * @returns {languagecheck.ExtractionExclusion} ExtractionExclusion instance
         * @type {{
         *   (properties: languagecheck.ExtractionExclusion.$Shape): languagecheck.ExtractionExclusion & languagecheck.ExtractionExclusion.$Shape;
         *   (properties?: languagecheck.ExtractionExclusion.$Properties): languagecheck.ExtractionExclusion;
         * }}
         */
        ExtractionExclusion.create = function create(properties) {
            return new ExtractionExclusion(properties);
        };

        /**
         * Encodes the specified ExtractionExclusion message. Does not implicitly {@link languagecheck.ExtractionExclusion.verify|verify} messages.
         * @function encode
         * @memberof languagecheck.ExtractionExclusion
         * @static
         * @param {languagecheck.ExtractionExclusion.$Properties} message ExtractionExclusion message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        ExtractionExclusion.encode = function encode(message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            if (message.startByte != null && Object.hasOwnProperty.call(message, "startByte"))
                writer.uint32(/* id 1, wireType 0 =*/8).uint32(message.startByte);
            if (message.endByte != null && Object.hasOwnProperty.call(message, "endByte"))
                writer.uint32(/* id 2, wireType 0 =*/16).uint32(message.endByte);
            if (message.$unknowns != null && Object.hasOwnProperty.call(message, "$unknowns"))
                for (var i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Encodes the specified ExtractionExclusion message, length delimited. Does not implicitly {@link languagecheck.ExtractionExclusion.verify|verify} messages.
         * @function encodeDelimited
         * @memberof languagecheck.ExtractionExclusion
         * @static
         * @param {languagecheck.ExtractionExclusion.$Properties} message ExtractionExclusion message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        ExtractionExclusion.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer && writer.len ? writer.fork() : writer).ldelim();
        };

        /**
         * Decodes an ExtractionExclusion message from the specified reader or buffer.
         * @function decode
         * @memberof languagecheck.ExtractionExclusion
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {languagecheck.ExtractionExclusion & languagecheck.ExtractionExclusion.$Shape} ExtractionExclusion
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        ExtractionExclusion.decode = function decode(reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw Error("max depth exceeded");
            var end = length === undefined ? reader.len : reader.pos + length, message = _target || new $root.languagecheck.ExtractionExclusion(), value;
            while (reader.pos < end) {
                var start = reader.pos;
                var tag = reader.tag();
                if (tag === _end) {
                    _end = undefined;
                    break;
                }
                var wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 0)
                            break;
                        if (value = reader.uint32())
                            message.startByte = value;
                        else
                            delete message.startByte;
                        continue;
                    }
                case 2: {
                        if (wireType !== 0)
                            break;
                        if (value = reader.uint32())
                            message.endByte = value;
                        else
                            delete message.endByte;
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                $util.makeProp(message, "$unknowns", false);
                (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
            }
            if (_end !== undefined)
                throw Error("missing end group");
            return message;
        };

        /**
         * Decodes an ExtractionExclusion message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof languagecheck.ExtractionExclusion
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {languagecheck.ExtractionExclusion & languagecheck.ExtractionExclusion.$Shape} ExtractionExclusion
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        ExtractionExclusion.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies an ExtractionExclusion message.
         * @function verify
         * @memberof languagecheck.ExtractionExclusion
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        ExtractionExclusion.verify = function verify(message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (message.startByte != null && message.hasOwnProperty("startByte"))
                if (!$util.isInteger(message.startByte))
                    return "startByte: integer expected";
            if (message.endByte != null && message.hasOwnProperty("endByte"))
                if (!$util.isInteger(message.endByte))
                    return "endByte: integer expected";
            return null;
        };

        /**
         * Creates an ExtractionExclusion message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof languagecheck.ExtractionExclusion
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {languagecheck.ExtractionExclusion} ExtractionExclusion
         */
        ExtractionExclusion.fromObject = function fromObject(object, _depth) {
            if (object instanceof $root.languagecheck.ExtractionExclusion)
                return object;
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            var message = new $root.languagecheck.ExtractionExclusion();
            if (object.startByte != null)
                if (Number(object.startByte) !== 0)
                    message.startByte = object.startByte >>> 0;
            if (object.endByte != null)
                if (Number(object.endByte) !== 0)
                    message.endByte = object.endByte >>> 0;
            return message;
        };

        /**
         * Creates a plain object from an ExtractionExclusion message. Also converts values to other types if specified.
         * @function toObject
         * @memberof languagecheck.ExtractionExclusion
         * @static
         * @param {languagecheck.ExtractionExclusion} message ExtractionExclusion
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        ExtractionExclusion.toObject = function toObject(message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            var object = {};
            if (options.defaults) {
                object.startByte = 0;
                object.endByte = 0;
            }
            if (message.startByte != null && message.hasOwnProperty("startByte"))
                object.startByte = message.startByte;
            if (message.endByte != null && message.hasOwnProperty("endByte"))
                object.endByte = message.endByte;
            return object;
        };

        /**
         * Converts this ExtractionExclusion to JSON.
         * @function toJSON
         * @memberof languagecheck.ExtractionExclusion
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        ExtractionExclusion.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the type url for ExtractionExclusion
         * @function getTypeUrl
         * @memberof languagecheck.ExtractionExclusion
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        ExtractionExclusion.getTypeUrl = function getTypeUrl(prefix) {
            if (prefix === undefined)
                prefix = "type.googleapis.com";
            return prefix + "/languagecheck.ExtractionExclusion";
        };

        return ExtractionExclusion;
    })();

    languagecheck.ExtractionProseRange = (function() {

        /**
         * Properties of an ExtractionProseRange.
         * @typedef {Object} languagecheck.ExtractionProseRange.$Properties
         * @property {number|null} [startByte] ExtractionProseRange startByte
         * @property {number|null} [endByte] ExtractionProseRange endByte
         * @property {Array.<languagecheck.ExtractionExclusion.$Properties>|null} [exclusions] ExtractionProseRange exclusions
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding
         */

        /**
         * Properties of an ExtractionProseRange.
         * @memberof languagecheck
         * @interface IExtractionProseRange
         * @augments languagecheck.ExtractionProseRange.$Properties
         * @deprecated Use languagecheck.ExtractionProseRange.$Properties instead.
         */

        /**
         * Shape of an ExtractionProseRange.
         * @typedef {languagecheck.ExtractionProseRange.$Properties} languagecheck.ExtractionProseRange.$Shape
         */

        /**
         * Constructs a new ExtractionProseRange.
         * @memberof languagecheck
         * @classdesc Represents an ExtractionProseRange.
         * @constructor
         * @param {languagecheck.ExtractionProseRange.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding
         */
        function ExtractionProseRange(properties) {
            this.exclusions = [];
            if (properties)
                for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * ExtractionProseRange startByte.
         * @member {number} startByte
         * @memberof languagecheck.ExtractionProseRange
         * @instance
         */
        ExtractionProseRange.prototype.startByte = 0;

        /**
         * ExtractionProseRange endByte.
         * @member {number} endByte
         * @memberof languagecheck.ExtractionProseRange
         * @instance
         */
        ExtractionProseRange.prototype.endByte = 0;

        /**
         * ExtractionProseRange exclusions.
         * @member {Array.<languagecheck.ExtractionExclusion.$Properties>} exclusions
         * @memberof languagecheck.ExtractionProseRange
         * @instance
         */
        ExtractionProseRange.prototype.exclusions = $util.emptyArray;

        /**
         * Creates a new ExtractionProseRange instance using the specified properties.
         * @function create
         * @memberof languagecheck.ExtractionProseRange
         * @static
         * @param {languagecheck.ExtractionProseRange.$Properties=} [properties] Properties to set
         * @returns {languagecheck.ExtractionProseRange} ExtractionProseRange instance
         * @type {{
         *   (properties: languagecheck.ExtractionProseRange.$Shape): languagecheck.ExtractionProseRange & languagecheck.ExtractionProseRange.$Shape;
         *   (properties?: languagecheck.ExtractionProseRange.$Properties): languagecheck.ExtractionProseRange;
         * }}
         */
        ExtractionProseRange.create = function create(properties) {
            return new ExtractionProseRange(properties);
        };

        /**
         * Encodes the specified ExtractionProseRange message. Does not implicitly {@link languagecheck.ExtractionProseRange.verify|verify} messages.
         * @function encode
         * @memberof languagecheck.ExtractionProseRange
         * @static
         * @param {languagecheck.ExtractionProseRange.$Properties} message ExtractionProseRange message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        ExtractionProseRange.encode = function encode(message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            if (message.startByte != null && Object.hasOwnProperty.call(message, "startByte"))
                writer.uint32(/* id 1, wireType 0 =*/8).uint32(message.startByte);
            if (message.endByte != null && Object.hasOwnProperty.call(message, "endByte"))
                writer.uint32(/* id 2, wireType 0 =*/16).uint32(message.endByte);
            if (message.exclusions != null && message.exclusions.length)
                for (var i = 0; i < message.exclusions.length; ++i)
                    $root.languagecheck.ExtractionExclusion.encode(message.exclusions[i], writer.uint32(/* id 3, wireType 2 =*/26).fork(), _depth + 1).ldelim();
            if (message.$unknowns != null && Object.hasOwnProperty.call(message, "$unknowns"))
                for (var i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Encodes the specified ExtractionProseRange message, length delimited. Does not implicitly {@link languagecheck.ExtractionProseRange.verify|verify} messages.
         * @function encodeDelimited
         * @memberof languagecheck.ExtractionProseRange
         * @static
         * @param {languagecheck.ExtractionProseRange.$Properties} message ExtractionProseRange message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        ExtractionProseRange.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer && writer.len ? writer.fork() : writer).ldelim();
        };

        /**
         * Decodes an ExtractionProseRange message from the specified reader or buffer.
         * @function decode
         * @memberof languagecheck.ExtractionProseRange
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {languagecheck.ExtractionProseRange & languagecheck.ExtractionProseRange.$Shape} ExtractionProseRange
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        ExtractionProseRange.decode = function decode(reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw Error("max depth exceeded");
            var end = length === undefined ? reader.len : reader.pos + length, message = _target || new $root.languagecheck.ExtractionProseRange(), value;
            while (reader.pos < end) {
                var start = reader.pos;
                var tag = reader.tag();
                if (tag === _end) {
                    _end = undefined;
                    break;
                }
                var wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 0)
                            break;
                        if (value = reader.uint32())
                            message.startByte = value;
                        else
                            delete message.startByte;
                        continue;
                    }
                case 2: {
                        if (wireType !== 0)
                            break;
                        if (value = reader.uint32())
                            message.endByte = value;
                        else
                            delete message.endByte;
                        continue;
                    }
                case 3: {
                        if (wireType !== 2)
                            break;
                        if (!(message.exclusions && message.exclusions.length))
                            message.exclusions = [];
                        message.exclusions.push($root.languagecheck.ExtractionExclusion.decode(reader, reader.uint32(), undefined, _depth + 1));
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                $util.makeProp(message, "$unknowns", false);
                (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
            }
            if (_end !== undefined)
                throw Error("missing end group");
            return message;
        };

        /**
         * Decodes an ExtractionProseRange message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof languagecheck.ExtractionProseRange
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {languagecheck.ExtractionProseRange & languagecheck.ExtractionProseRange.$Shape} ExtractionProseRange
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        ExtractionProseRange.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies an ExtractionProseRange message.
         * @function verify
         * @memberof languagecheck.ExtractionProseRange
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        ExtractionProseRange.verify = function verify(message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (message.startByte != null && message.hasOwnProperty("startByte"))
                if (!$util.isInteger(message.startByte))
                    return "startByte: integer expected";
            if (message.endByte != null && message.hasOwnProperty("endByte"))
                if (!$util.isInteger(message.endByte))
                    return "endByte: integer expected";
            if (message.exclusions != null && message.hasOwnProperty("exclusions")) {
                if (!Array.isArray(message.exclusions))
                    return "exclusions: array expected";
                for (var i = 0; i < message.exclusions.length; ++i) {
                    var error = $root.languagecheck.ExtractionExclusion.verify(message.exclusions[i], _depth + 1);
                    if (error)
                        return "exclusions." + error;
                }
            }
            return null;
        };

        /**
         * Creates an ExtractionProseRange message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof languagecheck.ExtractionProseRange
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {languagecheck.ExtractionProseRange} ExtractionProseRange
         */
        ExtractionProseRange.fromObject = function fromObject(object, _depth) {
            if (object instanceof $root.languagecheck.ExtractionProseRange)
                return object;
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            var message = new $root.languagecheck.ExtractionProseRange();
            if (object.startByte != null)
                if (Number(object.startByte) !== 0)
                    message.startByte = object.startByte >>> 0;
            if (object.endByte != null)
                if (Number(object.endByte) !== 0)
                    message.endByte = object.endByte >>> 0;
            if (object.exclusions) {
                if (!Array.isArray(object.exclusions))
                    throw TypeError(".languagecheck.ExtractionProseRange.exclusions: array expected");
                message.exclusions = Array(object.exclusions.length);
                for (var i = 0; i < object.exclusions.length; ++i) {
                    if (typeof object.exclusions[i] !== "object")
                        throw TypeError(".languagecheck.ExtractionProseRange.exclusions: object expected");
                    message.exclusions[i] = $root.languagecheck.ExtractionExclusion.fromObject(object.exclusions[i], _depth + 1);
                }
            }
            return message;
        };

        /**
         * Creates a plain object from an ExtractionProseRange message. Also converts values to other types if specified.
         * @function toObject
         * @memberof languagecheck.ExtractionProseRange
         * @static
         * @param {languagecheck.ExtractionProseRange} message ExtractionProseRange
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        ExtractionProseRange.toObject = function toObject(message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            var object = {};
            if (options.arrays || options.defaults)
                object.exclusions = [];
            if (options.defaults) {
                object.startByte = 0;
                object.endByte = 0;
            }
            if (message.startByte != null && message.hasOwnProperty("startByte"))
                object.startByte = message.startByte;
            if (message.endByte != null && message.hasOwnProperty("endByte"))
                object.endByte = message.endByte;
            if (message.exclusions && message.exclusions.length) {
                object.exclusions = Array(message.exclusions.length);
                for (var j = 0; j < message.exclusions.length; ++j)
                    object.exclusions[j] = $root.languagecheck.ExtractionExclusion.toObject(message.exclusions[j], options, _depth + 1);
            }
            return object;
        };

        /**
         * Converts this ExtractionProseRange to JSON.
         * @function toJSON
         * @memberof languagecheck.ExtractionProseRange
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        ExtractionProseRange.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the type url for ExtractionProseRange
         * @function getTypeUrl
         * @memberof languagecheck.ExtractionProseRange
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        ExtractionProseRange.getTypeUrl = function getTypeUrl(prefix) {
            if (prefix === undefined)
                prefix = "type.googleapis.com";
            return prefix + "/languagecheck.ExtractionProseRange";
        };

        return ExtractionProseRange;
    })();

    languagecheck.ExtractionInfo = (function() {

        /**
         * Properties of an ExtractionInfo.
         * @typedef {Object} languagecheck.ExtractionInfo.$Properties
         * @property {Array.<languagecheck.ExtractionProseRange.$Properties>|null} [proseRanges] ExtractionInfo proseRanges
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding
         */

        /**
         * Properties of an ExtractionInfo.
         * @memberof languagecheck
         * @interface IExtractionInfo
         * @augments languagecheck.ExtractionInfo.$Properties
         * @deprecated Use languagecheck.ExtractionInfo.$Properties instead.
         */

        /**
         * Shape of an ExtractionInfo.
         * @typedef {languagecheck.ExtractionInfo.$Properties} languagecheck.ExtractionInfo.$Shape
         */

        /**
         * Constructs a new ExtractionInfo.
         * @memberof languagecheck
         * @classdesc Represents an ExtractionInfo.
         * @constructor
         * @param {languagecheck.ExtractionInfo.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding
         */
        function ExtractionInfo(properties) {
            this.proseRanges = [];
            if (properties)
                for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * ExtractionInfo proseRanges.
         * @member {Array.<languagecheck.ExtractionProseRange.$Properties>} proseRanges
         * @memberof languagecheck.ExtractionInfo
         * @instance
         */
        ExtractionInfo.prototype.proseRanges = $util.emptyArray;

        /**
         * Creates a new ExtractionInfo instance using the specified properties.
         * @function create
         * @memberof languagecheck.ExtractionInfo
         * @static
         * @param {languagecheck.ExtractionInfo.$Properties=} [properties] Properties to set
         * @returns {languagecheck.ExtractionInfo} ExtractionInfo instance
         * @type {{
         *   (properties: languagecheck.ExtractionInfo.$Shape): languagecheck.ExtractionInfo & languagecheck.ExtractionInfo.$Shape;
         *   (properties?: languagecheck.ExtractionInfo.$Properties): languagecheck.ExtractionInfo;
         * }}
         */
        ExtractionInfo.create = function create(properties) {
            return new ExtractionInfo(properties);
        };

        /**
         * Encodes the specified ExtractionInfo message. Does not implicitly {@link languagecheck.ExtractionInfo.verify|verify} messages.
         * @function encode
         * @memberof languagecheck.ExtractionInfo
         * @static
         * @param {languagecheck.ExtractionInfo.$Properties} message ExtractionInfo message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        ExtractionInfo.encode = function encode(message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            if (message.proseRanges != null && message.proseRanges.length)
                for (var i = 0; i < message.proseRanges.length; ++i)
                    $root.languagecheck.ExtractionProseRange.encode(message.proseRanges[i], writer.uint32(/* id 1, wireType 2 =*/10).fork(), _depth + 1).ldelim();
            if (message.$unknowns != null && Object.hasOwnProperty.call(message, "$unknowns"))
                for (var i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Encodes the specified ExtractionInfo message, length delimited. Does not implicitly {@link languagecheck.ExtractionInfo.verify|verify} messages.
         * @function encodeDelimited
         * @memberof languagecheck.ExtractionInfo
         * @static
         * @param {languagecheck.ExtractionInfo.$Properties} message ExtractionInfo message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        ExtractionInfo.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer && writer.len ? writer.fork() : writer).ldelim();
        };

        /**
         * Decodes an ExtractionInfo message from the specified reader or buffer.
         * @function decode
         * @memberof languagecheck.ExtractionInfo
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {languagecheck.ExtractionInfo & languagecheck.ExtractionInfo.$Shape} ExtractionInfo
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        ExtractionInfo.decode = function decode(reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw Error("max depth exceeded");
            var end = length === undefined ? reader.len : reader.pos + length, message = _target || new $root.languagecheck.ExtractionInfo();
            while (reader.pos < end) {
                var start = reader.pos;
                var tag = reader.tag();
                if (tag === _end) {
                    _end = undefined;
                    break;
                }
                var wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 2)
                            break;
                        if (!(message.proseRanges && message.proseRanges.length))
                            message.proseRanges = [];
                        message.proseRanges.push($root.languagecheck.ExtractionProseRange.decode(reader, reader.uint32(), undefined, _depth + 1));
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                $util.makeProp(message, "$unknowns", false);
                (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
            }
            if (_end !== undefined)
                throw Error("missing end group");
            return message;
        };

        /**
         * Decodes an ExtractionInfo message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof languagecheck.ExtractionInfo
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {languagecheck.ExtractionInfo & languagecheck.ExtractionInfo.$Shape} ExtractionInfo
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        ExtractionInfo.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies an ExtractionInfo message.
         * @function verify
         * @memberof languagecheck.ExtractionInfo
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        ExtractionInfo.verify = function verify(message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (message.proseRanges != null && message.hasOwnProperty("proseRanges")) {
                if (!Array.isArray(message.proseRanges))
                    return "proseRanges: array expected";
                for (var i = 0; i < message.proseRanges.length; ++i) {
                    var error = $root.languagecheck.ExtractionProseRange.verify(message.proseRanges[i], _depth + 1);
                    if (error)
                        return "proseRanges." + error;
                }
            }
            return null;
        };

        /**
         * Creates an ExtractionInfo message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof languagecheck.ExtractionInfo
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {languagecheck.ExtractionInfo} ExtractionInfo
         */
        ExtractionInfo.fromObject = function fromObject(object, _depth) {
            if (object instanceof $root.languagecheck.ExtractionInfo)
                return object;
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            var message = new $root.languagecheck.ExtractionInfo();
            if (object.proseRanges) {
                if (!Array.isArray(object.proseRanges))
                    throw TypeError(".languagecheck.ExtractionInfo.proseRanges: array expected");
                message.proseRanges = Array(object.proseRanges.length);
                for (var i = 0; i < object.proseRanges.length; ++i) {
                    if (typeof object.proseRanges[i] !== "object")
                        throw TypeError(".languagecheck.ExtractionInfo.proseRanges: object expected");
                    message.proseRanges[i] = $root.languagecheck.ExtractionProseRange.fromObject(object.proseRanges[i], _depth + 1);
                }
            }
            return message;
        };

        /**
         * Creates a plain object from an ExtractionInfo message. Also converts values to other types if specified.
         * @function toObject
         * @memberof languagecheck.ExtractionInfo
         * @static
         * @param {languagecheck.ExtractionInfo} message ExtractionInfo
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        ExtractionInfo.toObject = function toObject(message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            var object = {};
            if (options.arrays || options.defaults)
                object.proseRanges = [];
            if (message.proseRanges && message.proseRanges.length) {
                object.proseRanges = Array(message.proseRanges.length);
                for (var j = 0; j < message.proseRanges.length; ++j)
                    object.proseRanges[j] = $root.languagecheck.ExtractionProseRange.toObject(message.proseRanges[j], options, _depth + 1);
            }
            return object;
        };

        /**
         * Converts this ExtractionInfo to JSON.
         * @function toJSON
         * @memberof languagecheck.ExtractionInfo
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        ExtractionInfo.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the type url for ExtractionInfo
         * @function getTypeUrl
         * @memberof languagecheck.ExtractionInfo
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        ExtractionInfo.getTypeUrl = function getTypeUrl(prefix) {
            if (prefix === undefined)
                prefix = "type.googleapis.com";
            return prefix + "/languagecheck.ExtractionInfo";
        };

        return ExtractionInfo;
    })();

    languagecheck.Diagnostic = (function() {

        /**
         * Properties of a Diagnostic.
         * @typedef {Object} languagecheck.Diagnostic.$Properties
         * @property {number|null} [startByte] Diagnostic startByte
         * @property {number|null} [endByte] Diagnostic endByte
         * @property {string|null} [message] Diagnostic message
         * @property {Array.<string>|null} [suggestions] Diagnostic suggestions
         * @property {string|null} [ruleId] Diagnostic ruleId
         * @property {languagecheck.Severity|null} [severity] Diagnostic severity
         * @property {string|null} [unifiedId] Diagnostic unifiedId
         * @property {number|null} [confidence] Diagnostic confidence
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding
         */

        /**
         * Properties of a Diagnostic.
         * @memberof languagecheck
         * @interface IDiagnostic
         * @augments languagecheck.Diagnostic.$Properties
         * @deprecated Use languagecheck.Diagnostic.$Properties instead.
         */

        /**
         * Shape of a Diagnostic.
         * @typedef {languagecheck.Diagnostic.$Properties} languagecheck.Diagnostic.$Shape
         */

        /**
         * Constructs a new Diagnostic.
         * @memberof languagecheck
         * @classdesc Represents a Diagnostic.
         * @constructor
         * @param {languagecheck.Diagnostic.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding
         */
        function Diagnostic(properties) {
            this.suggestions = [];
            if (properties)
                for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * Diagnostic startByte.
         * @member {number} startByte
         * @memberof languagecheck.Diagnostic
         * @instance
         */
        Diagnostic.prototype.startByte = 0;

        /**
         * Diagnostic endByte.
         * @member {number} endByte
         * @memberof languagecheck.Diagnostic
         * @instance
         */
        Diagnostic.prototype.endByte = 0;

        /**
         * Diagnostic message.
         * @member {string} message
         * @memberof languagecheck.Diagnostic
         * @instance
         */
        Diagnostic.prototype.message = "";

        /**
         * Diagnostic suggestions.
         * @member {Array.<string>} suggestions
         * @memberof languagecheck.Diagnostic
         * @instance
         */
        Diagnostic.prototype.suggestions = $util.emptyArray;

        /**
         * Diagnostic ruleId.
         * @member {string} ruleId
         * @memberof languagecheck.Diagnostic
         * @instance
         */
        Diagnostic.prototype.ruleId = "";

        /**
         * Diagnostic severity.
         * @member {languagecheck.Severity} severity
         * @memberof languagecheck.Diagnostic
         * @instance
         */
        Diagnostic.prototype.severity = 0;

        /**
         * Diagnostic unifiedId.
         * @member {string} unifiedId
         * @memberof languagecheck.Diagnostic
         * @instance
         */
        Diagnostic.prototype.unifiedId = "";

        /**
         * Diagnostic confidence.
         * @member {number} confidence
         * @memberof languagecheck.Diagnostic
         * @instance
         */
        Diagnostic.prototype.confidence = 0;

        /**
         * Creates a new Diagnostic instance using the specified properties.
         * @function create
         * @memberof languagecheck.Diagnostic
         * @static
         * @param {languagecheck.Diagnostic.$Properties=} [properties] Properties to set
         * @returns {languagecheck.Diagnostic} Diagnostic instance
         * @type {{
         *   (properties: languagecheck.Diagnostic.$Shape): languagecheck.Diagnostic & languagecheck.Diagnostic.$Shape;
         *   (properties?: languagecheck.Diagnostic.$Properties): languagecheck.Diagnostic;
         * }}
         */
        Diagnostic.create = function create(properties) {
            return new Diagnostic(properties);
        };

        /**
         * Encodes the specified Diagnostic message. Does not implicitly {@link languagecheck.Diagnostic.verify|verify} messages.
         * @function encode
         * @memberof languagecheck.Diagnostic
         * @static
         * @param {languagecheck.Diagnostic.$Properties} message Diagnostic message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Diagnostic.encode = function encode(message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            if (message.startByte != null && Object.hasOwnProperty.call(message, "startByte"))
                writer.uint32(/* id 1, wireType 0 =*/8).uint32(message.startByte);
            if (message.endByte != null && Object.hasOwnProperty.call(message, "endByte"))
                writer.uint32(/* id 2, wireType 0 =*/16).uint32(message.endByte);
            if (message.message != null && Object.hasOwnProperty.call(message, "message"))
                writer.uint32(/* id 3, wireType 2 =*/26).string(message.message);
            if (message.suggestions != null && message.suggestions.length)
                for (var i = 0; i < message.suggestions.length; ++i)
                    writer.uint32(/* id 4, wireType 2 =*/34).string(message.suggestions[i]);
            if (message.ruleId != null && Object.hasOwnProperty.call(message, "ruleId"))
                writer.uint32(/* id 5, wireType 2 =*/42).string(message.ruleId);
            if (message.severity != null && Object.hasOwnProperty.call(message, "severity"))
                writer.uint32(/* id 6, wireType 0 =*/48).int32(message.severity);
            if (message.unifiedId != null && Object.hasOwnProperty.call(message, "unifiedId"))
                writer.uint32(/* id 7, wireType 2 =*/58).string(message.unifiedId);
            if (message.confidence != null && Object.hasOwnProperty.call(message, "confidence"))
                writer.uint32(/* id 8, wireType 5 =*/69).float(message.confidence);
            if (message.$unknowns != null && Object.hasOwnProperty.call(message, "$unknowns"))
                for (var i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Encodes the specified Diagnostic message, length delimited. Does not implicitly {@link languagecheck.Diagnostic.verify|verify} messages.
         * @function encodeDelimited
         * @memberof languagecheck.Diagnostic
         * @static
         * @param {languagecheck.Diagnostic.$Properties} message Diagnostic message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Diagnostic.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer && writer.len ? writer.fork() : writer).ldelim();
        };

        /**
         * Decodes a Diagnostic message from the specified reader or buffer.
         * @function decode
         * @memberof languagecheck.Diagnostic
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {languagecheck.Diagnostic & languagecheck.Diagnostic.$Shape} Diagnostic
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        Diagnostic.decode = function decode(reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw Error("max depth exceeded");
            var end = length === undefined ? reader.len : reader.pos + length, message = _target || new $root.languagecheck.Diagnostic(), value;
            while (reader.pos < end) {
                var start = reader.pos;
                var tag = reader.tag();
                if (tag === _end) {
                    _end = undefined;
                    break;
                }
                var wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 0)
                            break;
                        if (value = reader.uint32())
                            message.startByte = value;
                        else
                            delete message.startByte;
                        continue;
                    }
                case 2: {
                        if (wireType !== 0)
                            break;
                        if (value = reader.uint32())
                            message.endByte = value;
                        else
                            delete message.endByte;
                        continue;
                    }
                case 3: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.string()).length)
                            message.message = value;
                        else
                            delete message.message;
                        continue;
                    }
                case 4: {
                        if (wireType !== 2)
                            break;
                        if (!(message.suggestions && message.suggestions.length))
                            message.suggestions = [];
                        message.suggestions.push(reader.string());
                        continue;
                    }
                case 5: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.string()).length)
                            message.ruleId = value;
                        else
                            delete message.ruleId;
                        continue;
                    }
                case 6: {
                        if (wireType !== 0)
                            break;
                        if (value = reader.int32())
                            message.severity = value;
                        else
                            delete message.severity;
                        continue;
                    }
                case 7: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.string()).length)
                            message.unifiedId = value;
                        else
                            delete message.unifiedId;
                        continue;
                    }
                case 8: {
                        if (wireType !== 5)
                            break;
                        if ((value = reader.float()) !== 0)
                            message.confidence = value;
                        else
                            delete message.confidence;
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                $util.makeProp(message, "$unknowns", false);
                (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
            }
            if (_end !== undefined)
                throw Error("missing end group");
            return message;
        };

        /**
         * Decodes a Diagnostic message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof languagecheck.Diagnostic
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {languagecheck.Diagnostic & languagecheck.Diagnostic.$Shape} Diagnostic
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        Diagnostic.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a Diagnostic message.
         * @function verify
         * @memberof languagecheck.Diagnostic
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        Diagnostic.verify = function verify(message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (message.startByte != null && message.hasOwnProperty("startByte"))
                if (!$util.isInteger(message.startByte))
                    return "startByte: integer expected";
            if (message.endByte != null && message.hasOwnProperty("endByte"))
                if (!$util.isInteger(message.endByte))
                    return "endByte: integer expected";
            if (message.message != null && message.hasOwnProperty("message"))
                if (!$util.isString(message.message))
                    return "message: string expected";
            if (message.suggestions != null && message.hasOwnProperty("suggestions")) {
                if (!Array.isArray(message.suggestions))
                    return "suggestions: array expected";
                for (var i = 0; i < message.suggestions.length; ++i)
                    if (!$util.isString(message.suggestions[i]))
                        return "suggestions: string[] expected";
            }
            if (message.ruleId != null && message.hasOwnProperty("ruleId"))
                if (!$util.isString(message.ruleId))
                    return "ruleId: string expected";
            if (message.severity != null && message.hasOwnProperty("severity"))
                switch (message.severity) {
                default:
                    return "severity: enum value expected";
                case 0:
                case 1:
                case 2:
                case 3:
                case 4:
                    break;
                }
            if (message.unifiedId != null && message.hasOwnProperty("unifiedId"))
                if (!$util.isString(message.unifiedId))
                    return "unifiedId: string expected";
            if (message.confidence != null && message.hasOwnProperty("confidence"))
                if (typeof message.confidence !== "number")
                    return "confidence: number expected";
            return null;
        };

        /**
         * Creates a Diagnostic message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof languagecheck.Diagnostic
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {languagecheck.Diagnostic} Diagnostic
         */
        Diagnostic.fromObject = function fromObject(object, _depth) {
            if (object instanceof $root.languagecheck.Diagnostic)
                return object;
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            var message = new $root.languagecheck.Diagnostic();
            if (object.startByte != null)
                if (Number(object.startByte) !== 0)
                    message.startByte = object.startByte >>> 0;
            if (object.endByte != null)
                if (Number(object.endByte) !== 0)
                    message.endByte = object.endByte >>> 0;
            if (object.message != null)
                if (typeof object.message !== "string" || object.message.length)
                    message.message = String(object.message);
            if (object.suggestions) {
                if (!Array.isArray(object.suggestions))
                    throw TypeError(".languagecheck.Diagnostic.suggestions: array expected");
                message.suggestions = Array(object.suggestions.length);
                for (var i = 0; i < object.suggestions.length; ++i)
                    message.suggestions[i] = String(object.suggestions[i]);
            }
            if (object.ruleId != null)
                if (typeof object.ruleId !== "string" || object.ruleId.length)
                    message.ruleId = String(object.ruleId);
            if (object.severity !== 0 && (typeof object.severity !== "string" || $root.languagecheck.Severity[object.severity] !== 0))
                switch (object.severity) {
                default:
                    if (typeof object.severity === "number") {
                        message.severity = object.severity;
                        break;
                    }
                    break;
                case "SEVERITY_UNSPECIFIED":
                case 0:
                    message.severity = 0;
                    break;
                case "SEVERITY_INFORMATION":
                case 1:
                    message.severity = 1;
                    break;
                case "SEVERITY_WARNING":
                case 2:
                    message.severity = 2;
                    break;
                case "SEVERITY_ERROR":
                case 3:
                    message.severity = 3;
                    break;
                case "SEVERITY_HINT":
                case 4:
                    message.severity = 4;
                    break;
                }
            if (object.unifiedId != null)
                if (typeof object.unifiedId !== "string" || object.unifiedId.length)
                    message.unifiedId = String(object.unifiedId);
            if (object.confidence != null)
                if (Number(object.confidence) !== 0)
                    message.confidence = Number(object.confidence);
            return message;
        };

        /**
         * Creates a plain object from a Diagnostic message. Also converts values to other types if specified.
         * @function toObject
         * @memberof languagecheck.Diagnostic
         * @static
         * @param {languagecheck.Diagnostic} message Diagnostic
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        Diagnostic.toObject = function toObject(message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            var object = {};
            if (options.arrays || options.defaults)
                object.suggestions = [];
            if (options.defaults) {
                object.startByte = 0;
                object.endByte = 0;
                object.message = "";
                object.ruleId = "";
                object.severity = options.enums === String ? "SEVERITY_UNSPECIFIED" : 0;
                object.unifiedId = "";
                object.confidence = 0;
            }
            if (message.startByte != null && message.hasOwnProperty("startByte"))
                object.startByte = message.startByte;
            if (message.endByte != null && message.hasOwnProperty("endByte"))
                object.endByte = message.endByte;
            if (message.message != null && message.hasOwnProperty("message"))
                object.message = message.message;
            if (message.suggestions && message.suggestions.length) {
                object.suggestions = Array(message.suggestions.length);
                for (var j = 0; j < message.suggestions.length; ++j)
                    object.suggestions[j] = message.suggestions[j];
            }
            if (message.ruleId != null && message.hasOwnProperty("ruleId"))
                object.ruleId = message.ruleId;
            if (message.severity != null && message.hasOwnProperty("severity"))
                object.severity = options.enums === String ? $root.languagecheck.Severity[message.severity] === undefined ? message.severity : $root.languagecheck.Severity[message.severity] : message.severity;
            if (message.unifiedId != null && message.hasOwnProperty("unifiedId"))
                object.unifiedId = message.unifiedId;
            if (message.confidence != null && message.hasOwnProperty("confidence"))
                object.confidence = options.json && !isFinite(message.confidence) ? String(message.confidence) : message.confidence;
            return object;
        };

        /**
         * Converts this Diagnostic to JSON.
         * @function toJSON
         * @memberof languagecheck.Diagnostic
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        Diagnostic.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the type url for Diagnostic
         * @function getTypeUrl
         * @memberof languagecheck.Diagnostic
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        Diagnostic.getTypeUrl = function getTypeUrl(prefix) {
            if (prefix === undefined)
                prefix = "type.googleapis.com";
            return prefix + "/languagecheck.Diagnostic";
        };

        return Diagnostic;
    })();

    /**
     * Severity enum.
     * @name languagecheck.Severity
     * @enum {number}
     * @property {number} SEVERITY_UNSPECIFIED=0 SEVERITY_UNSPECIFIED value
     * @property {number} SEVERITY_INFORMATION=1 SEVERITY_INFORMATION value
     * @property {number} SEVERITY_WARNING=2 SEVERITY_WARNING value
     * @property {number} SEVERITY_ERROR=3 SEVERITY_ERROR value
     * @property {number} SEVERITY_HINT=4 SEVERITY_HINT value
     */
    languagecheck.Severity = (function() {
        var valuesById = {}, values = Object.create(valuesById);
        values[valuesById[0] = "SEVERITY_UNSPECIFIED"] = 0;
        values[valuesById[1] = "SEVERITY_INFORMATION"] = 1;
        values[valuesById[2] = "SEVERITY_WARNING"] = 2;
        values[valuesById[3] = "SEVERITY_ERROR"] = 3;
        values[valuesById[4] = "SEVERITY_HINT"] = 4;
        return values;
    })();

    languagecheck.AddDictionaryWordRequest = (function() {

        /**
         * Properties of an AddDictionaryWordRequest.
         * @typedef {Object} languagecheck.AddDictionaryWordRequest.$Properties
         * @property {string|null} [word] AddDictionaryWordRequest word
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding
         */

        /**
         * Properties of an AddDictionaryWordRequest.
         * @memberof languagecheck
         * @interface IAddDictionaryWordRequest
         * @augments languagecheck.AddDictionaryWordRequest.$Properties
         * @deprecated Use languagecheck.AddDictionaryWordRequest.$Properties instead.
         */

        /**
         * Shape of an AddDictionaryWordRequest.
         * @typedef {languagecheck.AddDictionaryWordRequest.$Properties} languagecheck.AddDictionaryWordRequest.$Shape
         */

        /**
         * Constructs a new AddDictionaryWordRequest.
         * @memberof languagecheck
         * @classdesc Represents an AddDictionaryWordRequest.
         * @constructor
         * @param {languagecheck.AddDictionaryWordRequest.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding
         */
        function AddDictionaryWordRequest(properties) {
            if (properties)
                for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * AddDictionaryWordRequest word.
         * @member {string} word
         * @memberof languagecheck.AddDictionaryWordRequest
         * @instance
         */
        AddDictionaryWordRequest.prototype.word = "";

        /**
         * Creates a new AddDictionaryWordRequest instance using the specified properties.
         * @function create
         * @memberof languagecheck.AddDictionaryWordRequest
         * @static
         * @param {languagecheck.AddDictionaryWordRequest.$Properties=} [properties] Properties to set
         * @returns {languagecheck.AddDictionaryWordRequest} AddDictionaryWordRequest instance
         * @type {{
         *   (properties: languagecheck.AddDictionaryWordRequest.$Shape): languagecheck.AddDictionaryWordRequest & languagecheck.AddDictionaryWordRequest.$Shape;
         *   (properties?: languagecheck.AddDictionaryWordRequest.$Properties): languagecheck.AddDictionaryWordRequest;
         * }}
         */
        AddDictionaryWordRequest.create = function create(properties) {
            return new AddDictionaryWordRequest(properties);
        };

        /**
         * Encodes the specified AddDictionaryWordRequest message. Does not implicitly {@link languagecheck.AddDictionaryWordRequest.verify|verify} messages.
         * @function encode
         * @memberof languagecheck.AddDictionaryWordRequest
         * @static
         * @param {languagecheck.AddDictionaryWordRequest.$Properties} message AddDictionaryWordRequest message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        AddDictionaryWordRequest.encode = function encode(message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            if (message.word != null && Object.hasOwnProperty.call(message, "word"))
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.word);
            if (message.$unknowns != null && Object.hasOwnProperty.call(message, "$unknowns"))
                for (var i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Encodes the specified AddDictionaryWordRequest message, length delimited. Does not implicitly {@link languagecheck.AddDictionaryWordRequest.verify|verify} messages.
         * @function encodeDelimited
         * @memberof languagecheck.AddDictionaryWordRequest
         * @static
         * @param {languagecheck.AddDictionaryWordRequest.$Properties} message AddDictionaryWordRequest message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        AddDictionaryWordRequest.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer && writer.len ? writer.fork() : writer).ldelim();
        };

        /**
         * Decodes an AddDictionaryWordRequest message from the specified reader or buffer.
         * @function decode
         * @memberof languagecheck.AddDictionaryWordRequest
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {languagecheck.AddDictionaryWordRequest & languagecheck.AddDictionaryWordRequest.$Shape} AddDictionaryWordRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        AddDictionaryWordRequest.decode = function decode(reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw Error("max depth exceeded");
            var end = length === undefined ? reader.len : reader.pos + length, message = _target || new $root.languagecheck.AddDictionaryWordRequest(), value;
            while (reader.pos < end) {
                var start = reader.pos;
                var tag = reader.tag();
                if (tag === _end) {
                    _end = undefined;
                    break;
                }
                var wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.string()).length)
                            message.word = value;
                        else
                            delete message.word;
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                $util.makeProp(message, "$unknowns", false);
                (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
            }
            if (_end !== undefined)
                throw Error("missing end group");
            return message;
        };

        /**
         * Decodes an AddDictionaryWordRequest message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof languagecheck.AddDictionaryWordRequest
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {languagecheck.AddDictionaryWordRequest & languagecheck.AddDictionaryWordRequest.$Shape} AddDictionaryWordRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        AddDictionaryWordRequest.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies an AddDictionaryWordRequest message.
         * @function verify
         * @memberof languagecheck.AddDictionaryWordRequest
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        AddDictionaryWordRequest.verify = function verify(message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (message.word != null && message.hasOwnProperty("word"))
                if (!$util.isString(message.word))
                    return "word: string expected";
            return null;
        };

        /**
         * Creates an AddDictionaryWordRequest message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof languagecheck.AddDictionaryWordRequest
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {languagecheck.AddDictionaryWordRequest} AddDictionaryWordRequest
         */
        AddDictionaryWordRequest.fromObject = function fromObject(object, _depth) {
            if (object instanceof $root.languagecheck.AddDictionaryWordRequest)
                return object;
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            var message = new $root.languagecheck.AddDictionaryWordRequest();
            if (object.word != null)
                if (typeof object.word !== "string" || object.word.length)
                    message.word = String(object.word);
            return message;
        };

        /**
         * Creates a plain object from an AddDictionaryWordRequest message. Also converts values to other types if specified.
         * @function toObject
         * @memberof languagecheck.AddDictionaryWordRequest
         * @static
         * @param {languagecheck.AddDictionaryWordRequest} message AddDictionaryWordRequest
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        AddDictionaryWordRequest.toObject = function toObject(message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            var object = {};
            if (options.defaults)
                object.word = "";
            if (message.word != null && message.hasOwnProperty("word"))
                object.word = message.word;
            return object;
        };

        /**
         * Converts this AddDictionaryWordRequest to JSON.
         * @function toJSON
         * @memberof languagecheck.AddDictionaryWordRequest
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        AddDictionaryWordRequest.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the type url for AddDictionaryWordRequest
         * @function getTypeUrl
         * @memberof languagecheck.AddDictionaryWordRequest
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        AddDictionaryWordRequest.getTypeUrl = function getTypeUrl(prefix) {
            if (prefix === undefined)
                prefix = "type.googleapis.com";
            return prefix + "/languagecheck.AddDictionaryWordRequest";
        };

        return AddDictionaryWordRequest;
    })();

    languagecheck.MetadataRequest = (function() {

        /**
         * Properties of a MetadataRequest.
         * @typedef {Object} languagecheck.MetadataRequest.$Properties
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding
         */

        /**
         * Properties of a MetadataRequest.
         * @memberof languagecheck
         * @interface IMetadataRequest
         * @augments languagecheck.MetadataRequest.$Properties
         * @deprecated Use languagecheck.MetadataRequest.$Properties instead.
         */

        /**
         * Shape of a MetadataRequest.
         * @typedef {languagecheck.MetadataRequest.$Properties} languagecheck.MetadataRequest.$Shape
         */

        /**
         * Constructs a new MetadataRequest.
         * @memberof languagecheck
         * @classdesc Represents a MetadataRequest.
         * @constructor
         * @param {languagecheck.MetadataRequest.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding
         */
        function MetadataRequest(properties) {
            if (properties)
                for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * Creates a new MetadataRequest instance using the specified properties.
         * @function create
         * @memberof languagecheck.MetadataRequest
         * @static
         * @param {languagecheck.MetadataRequest.$Properties=} [properties] Properties to set
         * @returns {languagecheck.MetadataRequest} MetadataRequest instance
         * @type {{
         *   (properties: languagecheck.MetadataRequest.$Shape): languagecheck.MetadataRequest & languagecheck.MetadataRequest.$Shape;
         *   (properties?: languagecheck.MetadataRequest.$Properties): languagecheck.MetadataRequest;
         * }}
         */
        MetadataRequest.create = function create(properties) {
            return new MetadataRequest(properties);
        };

        /**
         * Encodes the specified MetadataRequest message. Does not implicitly {@link languagecheck.MetadataRequest.verify|verify} messages.
         * @function encode
         * @memberof languagecheck.MetadataRequest
         * @static
         * @param {languagecheck.MetadataRequest.$Properties} message MetadataRequest message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        MetadataRequest.encode = function encode(message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            if (message.$unknowns != null && Object.hasOwnProperty.call(message, "$unknowns"))
                for (var i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Encodes the specified MetadataRequest message, length delimited. Does not implicitly {@link languagecheck.MetadataRequest.verify|verify} messages.
         * @function encodeDelimited
         * @memberof languagecheck.MetadataRequest
         * @static
         * @param {languagecheck.MetadataRequest.$Properties} message MetadataRequest message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        MetadataRequest.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer && writer.len ? writer.fork() : writer).ldelim();
        };

        /**
         * Decodes a MetadataRequest message from the specified reader or buffer.
         * @function decode
         * @memberof languagecheck.MetadataRequest
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {languagecheck.MetadataRequest & languagecheck.MetadataRequest.$Shape} MetadataRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        MetadataRequest.decode = function decode(reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw Error("max depth exceeded");
            var end = length === undefined ? reader.len : reader.pos + length, message = _target || new $root.languagecheck.MetadataRequest();
            while (reader.pos < end) {
                var start = reader.pos;
                var tag = reader.tag();
                if (tag === _end) {
                    _end = undefined;
                    break;
                }
                reader.skipType(tag & 7, _depth, tag);
                $util.makeProp(message, "$unknowns", false);
                (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
            }
            if (_end !== undefined)
                throw Error("missing end group");
            return message;
        };

        /**
         * Decodes a MetadataRequest message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof languagecheck.MetadataRequest
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {languagecheck.MetadataRequest & languagecheck.MetadataRequest.$Shape} MetadataRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        MetadataRequest.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a MetadataRequest message.
         * @function verify
         * @memberof languagecheck.MetadataRequest
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        MetadataRequest.verify = function verify(message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            return null;
        };

        /**
         * Creates a MetadataRequest message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof languagecheck.MetadataRequest
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {languagecheck.MetadataRequest} MetadataRequest
         */
        MetadataRequest.fromObject = function fromObject(object, _depth) {
            if (object instanceof $root.languagecheck.MetadataRequest)
                return object;
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            return new $root.languagecheck.MetadataRequest();
        };

        /**
         * Creates a plain object from a MetadataRequest message. Also converts values to other types if specified.
         * @function toObject
         * @memberof languagecheck.MetadataRequest
         * @static
         * @param {languagecheck.MetadataRequest} message MetadataRequest
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        MetadataRequest.toObject = function toObject() {
            return {};
        };

        /**
         * Converts this MetadataRequest to JSON.
         * @function toJSON
         * @memberof languagecheck.MetadataRequest
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        MetadataRequest.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the type url for MetadataRequest
         * @function getTypeUrl
         * @memberof languagecheck.MetadataRequest
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        MetadataRequest.getTypeUrl = function getTypeUrl(prefix) {
            if (prefix === undefined)
                prefix = "type.googleapis.com";
            return prefix + "/languagecheck.MetadataRequest";
        };

        return MetadataRequest;
    })();

    languagecheck.MetadataResponse = (function() {

        /**
         * Properties of a MetadataResponse.
         * @typedef {Object} languagecheck.MetadataResponse.$Properties
         * @property {string|null} [name] MetadataResponse name
         * @property {string|null} [version] MetadataResponse version
         * @property {Array.<string>|null} [supportedLanguages] MetadataResponse supportedLanguages
         * @property {string|null} [spellLanguage] MetadataResponse spellLanguage
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding
         */

        /**
         * Properties of a MetadataResponse.
         * @memberof languagecheck
         * @interface IMetadataResponse
         * @augments languagecheck.MetadataResponse.$Properties
         * @deprecated Use languagecheck.MetadataResponse.$Properties instead.
         */

        /**
         * Shape of a MetadataResponse.
         * @typedef {languagecheck.MetadataResponse.$Properties} languagecheck.MetadataResponse.$Shape
         */

        /**
         * Constructs a new MetadataResponse.
         * @memberof languagecheck
         * @classdesc Represents a MetadataResponse.
         * @constructor
         * @param {languagecheck.MetadataResponse.$Properties=} [properties] Properties to set
         * @property {Array.<Uint8Array>} [$unknowns] Unknown fields preserved while decoding
         */
        function MetadataResponse(properties) {
            this.supportedLanguages = [];
            if (properties)
                for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null && keys[i] !== "__proto__")
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * MetadataResponse name.
         * @member {string} name
         * @memberof languagecheck.MetadataResponse
         * @instance
         */
        MetadataResponse.prototype.name = "";

        /**
         * MetadataResponse version.
         * @member {string} version
         * @memberof languagecheck.MetadataResponse
         * @instance
         */
        MetadataResponse.prototype.version = "";

        /**
         * MetadataResponse supportedLanguages.
         * @member {Array.<string>} supportedLanguages
         * @memberof languagecheck.MetadataResponse
         * @instance
         */
        MetadataResponse.prototype.supportedLanguages = $util.emptyArray;

        /**
         * MetadataResponse spellLanguage.
         * @member {string} spellLanguage
         * @memberof languagecheck.MetadataResponse
         * @instance
         */
        MetadataResponse.prototype.spellLanguage = "";

        /**
         * Creates a new MetadataResponse instance using the specified properties.
         * @function create
         * @memberof languagecheck.MetadataResponse
         * @static
         * @param {languagecheck.MetadataResponse.$Properties=} [properties] Properties to set
         * @returns {languagecheck.MetadataResponse} MetadataResponse instance
         * @type {{
         *   (properties: languagecheck.MetadataResponse.$Shape): languagecheck.MetadataResponse & languagecheck.MetadataResponse.$Shape;
         *   (properties?: languagecheck.MetadataResponse.$Properties): languagecheck.MetadataResponse;
         * }}
         */
        MetadataResponse.create = function create(properties) {
            return new MetadataResponse(properties);
        };

        /**
         * Encodes the specified MetadataResponse message. Does not implicitly {@link languagecheck.MetadataResponse.verify|verify} messages.
         * @function encode
         * @memberof languagecheck.MetadataResponse
         * @static
         * @param {languagecheck.MetadataResponse.$Properties} message MetadataResponse message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        MetadataResponse.encode = function encode(message, writer, _depth) {
            if (!writer)
                writer = $Writer.create();
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            if (message.name != null && Object.hasOwnProperty.call(message, "name"))
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.name);
            if (message.version != null && Object.hasOwnProperty.call(message, "version"))
                writer.uint32(/* id 2, wireType 2 =*/18).string(message.version);
            if (message.supportedLanguages != null && message.supportedLanguages.length)
                for (var i = 0; i < message.supportedLanguages.length; ++i)
                    writer.uint32(/* id 3, wireType 2 =*/26).string(message.supportedLanguages[i]);
            if (message.spellLanguage != null && Object.hasOwnProperty.call(message, "spellLanguage"))
                writer.uint32(/* id 4, wireType 2 =*/34).string(message.spellLanguage);
            if (message.$unknowns != null && Object.hasOwnProperty.call(message, "$unknowns"))
                for (var i = 0; i < message.$unknowns.length; ++i)
                    writer.raw(message.$unknowns[i]);
            return writer;
        };

        /**
         * Encodes the specified MetadataResponse message, length delimited. Does not implicitly {@link languagecheck.MetadataResponse.verify|verify} messages.
         * @function encodeDelimited
         * @memberof languagecheck.MetadataResponse
         * @static
         * @param {languagecheck.MetadataResponse.$Properties} message MetadataResponse message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        MetadataResponse.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer && writer.len ? writer.fork() : writer).ldelim();
        };

        /**
         * Decodes a MetadataResponse message from the specified reader or buffer.
         * @function decode
         * @memberof languagecheck.MetadataResponse
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {languagecheck.MetadataResponse & languagecheck.MetadataResponse.$Shape} MetadataResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        MetadataResponse.decode = function decode(reader, length, _end, _depth, _target) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $Reader.recursionLimit)
                throw Error("max depth exceeded");
            var end = length === undefined ? reader.len : reader.pos + length, message = _target || new $root.languagecheck.MetadataResponse(), value;
            while (reader.pos < end) {
                var start = reader.pos;
                var tag = reader.tag();
                if (tag === _end) {
                    _end = undefined;
                    break;
                }
                var wireType = tag & 7;
                switch (tag >>>= 3) {
                case 1: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.string()).length)
                            message.name = value;
                        else
                            delete message.name;
                        continue;
                    }
                case 2: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.string()).length)
                            message.version = value;
                        else
                            delete message.version;
                        continue;
                    }
                case 3: {
                        if (wireType !== 2)
                            break;
                        if (!(message.supportedLanguages && message.supportedLanguages.length))
                            message.supportedLanguages = [];
                        message.supportedLanguages.push(reader.string());
                        continue;
                    }
                case 4: {
                        if (wireType !== 2)
                            break;
                        if ((value = reader.string()).length)
                            message.spellLanguage = value;
                        else
                            delete message.spellLanguage;
                        continue;
                    }
                }
                reader.skipType(wireType, _depth, tag);
                $util.makeProp(message, "$unknowns", false);
                (message.$unknowns || (message.$unknowns = [])).push(reader.raw(start, reader.pos));
            }
            if (_end !== undefined)
                throw Error("missing end group");
            return message;
        };

        /**
         * Decodes a MetadataResponse message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof languagecheck.MetadataResponse
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {languagecheck.MetadataResponse & languagecheck.MetadataResponse.$Shape} MetadataResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        MetadataResponse.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a MetadataResponse message.
         * @function verify
         * @memberof languagecheck.MetadataResponse
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        MetadataResponse.verify = function verify(message, _depth) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                return "max depth exceeded";
            if (message.name != null && message.hasOwnProperty("name"))
                if (!$util.isString(message.name))
                    return "name: string expected";
            if (message.version != null && message.hasOwnProperty("version"))
                if (!$util.isString(message.version))
                    return "version: string expected";
            if (message.supportedLanguages != null && message.hasOwnProperty("supportedLanguages")) {
                if (!Array.isArray(message.supportedLanguages))
                    return "supportedLanguages: array expected";
                for (var i = 0; i < message.supportedLanguages.length; ++i)
                    if (!$util.isString(message.supportedLanguages[i]))
                        return "supportedLanguages: string[] expected";
            }
            if (message.spellLanguage != null && message.hasOwnProperty("spellLanguage"))
                if (!$util.isString(message.spellLanguage))
                    return "spellLanguage: string expected";
            return null;
        };

        /**
         * Creates a MetadataResponse message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof languagecheck.MetadataResponse
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {languagecheck.MetadataResponse} MetadataResponse
         */
        MetadataResponse.fromObject = function fromObject(object, _depth) {
            if (object instanceof $root.languagecheck.MetadataResponse)
                return object;
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            var message = new $root.languagecheck.MetadataResponse();
            if (object.name != null)
                if (typeof object.name !== "string" || object.name.length)
                    message.name = String(object.name);
            if (object.version != null)
                if (typeof object.version !== "string" || object.version.length)
                    message.version = String(object.version);
            if (object.supportedLanguages) {
                if (!Array.isArray(object.supportedLanguages))
                    throw TypeError(".languagecheck.MetadataResponse.supportedLanguages: array expected");
                message.supportedLanguages = Array(object.supportedLanguages.length);
                for (var i = 0; i < object.supportedLanguages.length; ++i)
                    message.supportedLanguages[i] = String(object.supportedLanguages[i]);
            }
            if (object.spellLanguage != null)
                if (typeof object.spellLanguage !== "string" || object.spellLanguage.length)
                    message.spellLanguage = String(object.spellLanguage);
            return message;
        };

        /**
         * Creates a plain object from a MetadataResponse message. Also converts values to other types if specified.
         * @function toObject
         * @memberof languagecheck.MetadataResponse
         * @static
         * @param {languagecheck.MetadataResponse} message MetadataResponse
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        MetadataResponse.toObject = function toObject(message, options, _depth) {
            if (!options)
                options = {};
            if (_depth === undefined)
                _depth = 0;
            if (_depth > $util.recursionLimit)
                throw Error("max depth exceeded");
            var object = {};
            if (options.arrays || options.defaults)
                object.supportedLanguages = [];
            if (options.defaults) {
                object.name = "";
                object.version = "";
                object.spellLanguage = "";
            }
            if (message.name != null && message.hasOwnProperty("name"))
                object.name = message.name;
            if (message.version != null && message.hasOwnProperty("version"))
                object.version = message.version;
            if (message.supportedLanguages && message.supportedLanguages.length) {
                object.supportedLanguages = Array(message.supportedLanguages.length);
                for (var j = 0; j < message.supportedLanguages.length; ++j)
                    object.supportedLanguages[j] = message.supportedLanguages[j];
            }
            if (message.spellLanguage != null && message.hasOwnProperty("spellLanguage"))
                object.spellLanguage = message.spellLanguage;
            return object;
        };

        /**
         * Converts this MetadataResponse to JSON.
         * @function toJSON
         * @memberof languagecheck.MetadataResponse
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        MetadataResponse.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the type url for MetadataResponse
         * @function getTypeUrl
         * @memberof languagecheck.MetadataResponse
         * @static
         * @param {string} [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns {string} The type url
         */
        MetadataResponse.getTypeUrl = function getTypeUrl(prefix) {
            if (prefix === undefined)
                prefix = "type.googleapis.com";
            return prefix + "/languagecheck.MetadataResponse";
        };

        return MetadataResponse;
    })();

    return languagecheck;
})();

module.exports = $root;
