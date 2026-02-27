/*eslint-disable block-scoped-var, id-length, no-control-regex, no-magic-numbers, no-prototype-builtins, no-redeclare, no-shadow, no-var, sort-vars*/
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
         * @memberof languagecheck
         * @interface IRequest
         * @property {number|Long|null} [id] Request id
         * @property {languagecheck.ICheckRequest|null} [checkProse] Request checkProse
         * @property {languagecheck.IMetadataRequest|null} [getMetadata] Request getMetadata
         * @property {languagecheck.IIgnoreRequest|null} [ignore] Request ignore
         * @property {languagecheck.IInitializeRequest|null} [initialize] Request initialize
         */

        /**
         * Constructs a new Request.
         * @memberof languagecheck
         * @classdesc Represents a Request.
         * @implements IRequest
         * @constructor
         * @param {languagecheck.IRequest=} [properties] Properties to set
         */
        function Request(properties) {
            if (properties)
                for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
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
         * @member {languagecheck.ICheckRequest|null|undefined} checkProse
         * @memberof languagecheck.Request
         * @instance
         */
        Request.prototype.checkProse = null;

        /**
         * Request getMetadata.
         * @member {languagecheck.IMetadataRequest|null|undefined} getMetadata
         * @memberof languagecheck.Request
         * @instance
         */
        Request.prototype.getMetadata = null;

        /**
         * Request ignore.
         * @member {languagecheck.IIgnoreRequest|null|undefined} ignore
         * @memberof languagecheck.Request
         * @instance
         */
        Request.prototype.ignore = null;

        /**
         * Request initialize.
         * @member {languagecheck.IInitializeRequest|null|undefined} initialize
         * @memberof languagecheck.Request
         * @instance
         */
        Request.prototype.initialize = null;

        // OneOf field names bound to virtual getters and setters
        var $oneOfFields;

        /**
         * Request payload.
         * @member {"checkProse"|"getMetadata"|"ignore"|"initialize"|undefined} payload
         * @memberof languagecheck.Request
         * @instance
         */
        Object.defineProperty(Request.prototype, "payload", {
            get: $util.oneOfGetter($oneOfFields = ["checkProse", "getMetadata", "ignore", "initialize"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        /**
         * Creates a new Request instance using the specified properties.
         * @function create
         * @memberof languagecheck.Request
         * @static
         * @param {languagecheck.IRequest=} [properties] Properties to set
         * @returns {languagecheck.Request} Request instance
         */
        Request.create = function create(properties) {
            return new Request(properties);
        };

        /**
         * Encodes the specified Request message. Does not implicitly {@link languagecheck.Request.verify|verify} messages.
         * @function encode
         * @memberof languagecheck.Request
         * @static
         * @param {languagecheck.IRequest} message Request message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Request.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.id != null && Object.hasOwnProperty.call(message, "id"))
                writer.uint32(/* id 1, wireType 0 =*/8).uint64(message.id);
            if (message.checkProse != null && Object.hasOwnProperty.call(message, "checkProse"))
                $root.languagecheck.CheckRequest.encode(message.checkProse, writer.uint32(/* id 2, wireType 2 =*/18).fork()).ldelim();
            if (message.getMetadata != null && Object.hasOwnProperty.call(message, "getMetadata"))
                $root.languagecheck.MetadataRequest.encode(message.getMetadata, writer.uint32(/* id 3, wireType 2 =*/26).fork()).ldelim();
            if (message.ignore != null && Object.hasOwnProperty.call(message, "ignore"))
                $root.languagecheck.IgnoreRequest.encode(message.ignore, writer.uint32(/* id 4, wireType 2 =*/34).fork()).ldelim();
            if (message.initialize != null && Object.hasOwnProperty.call(message, "initialize"))
                $root.languagecheck.InitializeRequest.encode(message.initialize, writer.uint32(/* id 5, wireType 2 =*/42).fork()).ldelim();
            return writer;
        };

        /**
         * Encodes the specified Request message, length delimited. Does not implicitly {@link languagecheck.Request.verify|verify} messages.
         * @function encodeDelimited
         * @memberof languagecheck.Request
         * @static
         * @param {languagecheck.IRequest} message Request message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Request.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a Request message from the specified reader or buffer.
         * @function decode
         * @memberof languagecheck.Request
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {languagecheck.Request} Request
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        Request.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            var end = length === undefined ? reader.len : reader.pos + length, message = new $root.languagecheck.Request();
            while (reader.pos < end) {
                var tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.id = reader.uint64();
                        break;
                    }
                case 2: {
                        message.checkProse = $root.languagecheck.CheckRequest.decode(reader, reader.uint32());
                        break;
                    }
                case 3: {
                        message.getMetadata = $root.languagecheck.MetadataRequest.decode(reader, reader.uint32());
                        break;
                    }
                case 4: {
                        message.ignore = $root.languagecheck.IgnoreRequest.decode(reader, reader.uint32());
                        break;
                    }
                case 5: {
                        message.initialize = $root.languagecheck.InitializeRequest.decode(reader, reader.uint32());
                        break;
                    }
                default:
                    reader.skipType(tag & 7);
                    break;
                }
            }
            return message;
        };

        /**
         * Decodes a Request message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof languagecheck.Request
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {languagecheck.Request} Request
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
        Request.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            var properties = {};
            if (message.id != null && message.hasOwnProperty("id"))
                if (!$util.isInteger(message.id) && !(message.id && $util.isInteger(message.id.low) && $util.isInteger(message.id.high)))
                    return "id: integer|Long expected";
            if (message.checkProse != null && message.hasOwnProperty("checkProse")) {
                properties.payload = 1;
                {
                    var error = $root.languagecheck.CheckRequest.verify(message.checkProse);
                    if (error)
                        return "checkProse." + error;
                }
            }
            if (message.getMetadata != null && message.hasOwnProperty("getMetadata")) {
                if (properties.payload === 1)
                    return "payload: multiple values";
                properties.payload = 1;
                {
                    var error = $root.languagecheck.MetadataRequest.verify(message.getMetadata);
                    if (error)
                        return "getMetadata." + error;
                }
            }
            if (message.ignore != null && message.hasOwnProperty("ignore")) {
                if (properties.payload === 1)
                    return "payload: multiple values";
                properties.payload = 1;
                {
                    var error = $root.languagecheck.IgnoreRequest.verify(message.ignore);
                    if (error)
                        return "ignore." + error;
                }
            }
            if (message.initialize != null && message.hasOwnProperty("initialize")) {
                if (properties.payload === 1)
                    return "payload: multiple values";
                properties.payload = 1;
                {
                    var error = $root.languagecheck.InitializeRequest.verify(message.initialize);
                    if (error)
                        return "initialize." + error;
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
        Request.fromObject = function fromObject(object) {
            if (object instanceof $root.languagecheck.Request)
                return object;
            var message = new $root.languagecheck.Request();
            if (object.id != null)
                if ($util.Long)
                    (message.id = $util.Long.fromValue(object.id)).unsigned = true;
                else if (typeof object.id === "string")
                    message.id = parseInt(object.id, 10);
                else if (typeof object.id === "number")
                    message.id = object.id;
                else if (typeof object.id === "object")
                    message.id = new $util.LongBits(object.id.low >>> 0, object.id.high >>> 0).toNumber(true);
            if (object.checkProse != null) {
                if (typeof object.checkProse !== "object")
                    throw TypeError(".languagecheck.Request.checkProse: object expected");
                message.checkProse = $root.languagecheck.CheckRequest.fromObject(object.checkProse);
            }
            if (object.getMetadata != null) {
                if (typeof object.getMetadata !== "object")
                    throw TypeError(".languagecheck.Request.getMetadata: object expected");
                message.getMetadata = $root.languagecheck.MetadataRequest.fromObject(object.getMetadata);
            }
            if (object.ignore != null) {
                if (typeof object.ignore !== "object")
                    throw TypeError(".languagecheck.Request.ignore: object expected");
                message.ignore = $root.languagecheck.IgnoreRequest.fromObject(object.ignore);
            }
            if (object.initialize != null) {
                if (typeof object.initialize !== "object")
                    throw TypeError(".languagecheck.Request.initialize: object expected");
                message.initialize = $root.languagecheck.InitializeRequest.fromObject(object.initialize);
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
        Request.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            var object = {};
            if (options.defaults)
                if ($util.Long) {
                    var long = new $util.Long(0, 0, true);
                    object.id = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : long;
                } else
                    object.id = options.longs === String ? "0" : 0;
            if (message.id != null && message.hasOwnProperty("id"))
                if (typeof message.id === "number")
                    object.id = options.longs === String ? String(message.id) : message.id;
                else
                    object.id = options.longs === String ? $util.Long.prototype.toString.call(message.id) : options.longs === Number ? new $util.LongBits(message.id.low >>> 0, message.id.high >>> 0).toNumber(true) : message.id;
            if (message.checkProse != null && message.hasOwnProperty("checkProse")) {
                object.checkProse = $root.languagecheck.CheckRequest.toObject(message.checkProse, options);
                if (options.oneofs)
                    object.payload = "checkProse";
            }
            if (message.getMetadata != null && message.hasOwnProperty("getMetadata")) {
                object.getMetadata = $root.languagecheck.MetadataRequest.toObject(message.getMetadata, options);
                if (options.oneofs)
                    object.payload = "getMetadata";
            }
            if (message.ignore != null && message.hasOwnProperty("ignore")) {
                object.ignore = $root.languagecheck.IgnoreRequest.toObject(message.ignore, options);
                if (options.oneofs)
                    object.payload = "ignore";
            }
            if (message.initialize != null && message.hasOwnProperty("initialize")) {
                object.initialize = $root.languagecheck.InitializeRequest.toObject(message.initialize, options);
                if (options.oneofs)
                    object.payload = "initialize";
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
         * Gets the default type url for Request
         * @function getTypeUrl
         * @memberof languagecheck.Request
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        Request.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/languagecheck.Request";
        };

        return Request;
    })();

    languagecheck.InitializeRequest = (function() {

        /**
         * Properties of an InitializeRequest.
         * @memberof languagecheck
         * @interface IInitializeRequest
         * @property {string|null} [workspaceRoot] InitializeRequest workspaceRoot
         */

        /**
         * Constructs a new InitializeRequest.
         * @memberof languagecheck
         * @classdesc Represents an InitializeRequest.
         * @implements IInitializeRequest
         * @constructor
         * @param {languagecheck.IInitializeRequest=} [properties] Properties to set
         */
        function InitializeRequest(properties) {
            if (properties)
                for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
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
         * Creates a new InitializeRequest instance using the specified properties.
         * @function create
         * @memberof languagecheck.InitializeRequest
         * @static
         * @param {languagecheck.IInitializeRequest=} [properties] Properties to set
         * @returns {languagecheck.InitializeRequest} InitializeRequest instance
         */
        InitializeRequest.create = function create(properties) {
            return new InitializeRequest(properties);
        };

        /**
         * Encodes the specified InitializeRequest message. Does not implicitly {@link languagecheck.InitializeRequest.verify|verify} messages.
         * @function encode
         * @memberof languagecheck.InitializeRequest
         * @static
         * @param {languagecheck.IInitializeRequest} message InitializeRequest message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        InitializeRequest.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.workspaceRoot != null && Object.hasOwnProperty.call(message, "workspaceRoot"))
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.workspaceRoot);
            return writer;
        };

        /**
         * Encodes the specified InitializeRequest message, length delimited. Does not implicitly {@link languagecheck.InitializeRequest.verify|verify} messages.
         * @function encodeDelimited
         * @memberof languagecheck.InitializeRequest
         * @static
         * @param {languagecheck.IInitializeRequest} message InitializeRequest message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        InitializeRequest.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes an InitializeRequest message from the specified reader or buffer.
         * @function decode
         * @memberof languagecheck.InitializeRequest
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {languagecheck.InitializeRequest} InitializeRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        InitializeRequest.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            var end = length === undefined ? reader.len : reader.pos + length, message = new $root.languagecheck.InitializeRequest();
            while (reader.pos < end) {
                var tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.workspaceRoot = reader.string();
                        break;
                    }
                default:
                    reader.skipType(tag & 7);
                    break;
                }
            }
            return message;
        };

        /**
         * Decodes an InitializeRequest message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof languagecheck.InitializeRequest
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {languagecheck.InitializeRequest} InitializeRequest
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
        InitializeRequest.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (message.workspaceRoot != null && message.hasOwnProperty("workspaceRoot"))
                if (!$util.isString(message.workspaceRoot))
                    return "workspaceRoot: string expected";
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
        InitializeRequest.fromObject = function fromObject(object) {
            if (object instanceof $root.languagecheck.InitializeRequest)
                return object;
            var message = new $root.languagecheck.InitializeRequest();
            if (object.workspaceRoot != null)
                message.workspaceRoot = String(object.workspaceRoot);
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
        InitializeRequest.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            var object = {};
            if (options.defaults)
                object.workspaceRoot = "";
            if (message.workspaceRoot != null && message.hasOwnProperty("workspaceRoot"))
                object.workspaceRoot = message.workspaceRoot;
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
         * Gets the default type url for InitializeRequest
         * @function getTypeUrl
         * @memberof languagecheck.InitializeRequest
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        InitializeRequest.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/languagecheck.InitializeRequest";
        };

        return InitializeRequest;
    })();

    languagecheck.IgnoreRequest = (function() {

        /**
         * Properties of an IgnoreRequest.
         * @memberof languagecheck
         * @interface IIgnoreRequest
         * @property {string|null} [message] IgnoreRequest message
         * @property {string|null} [context] IgnoreRequest context
         */

        /**
         * Constructs a new IgnoreRequest.
         * @memberof languagecheck
         * @classdesc Represents an IgnoreRequest.
         * @implements IIgnoreRequest
         * @constructor
         * @param {languagecheck.IIgnoreRequest=} [properties] Properties to set
         */
        function IgnoreRequest(properties) {
            if (properties)
                for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
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
         * Creates a new IgnoreRequest instance using the specified properties.
         * @function create
         * @memberof languagecheck.IgnoreRequest
         * @static
         * @param {languagecheck.IIgnoreRequest=} [properties] Properties to set
         * @returns {languagecheck.IgnoreRequest} IgnoreRequest instance
         */
        IgnoreRequest.create = function create(properties) {
            return new IgnoreRequest(properties);
        };

        /**
         * Encodes the specified IgnoreRequest message. Does not implicitly {@link languagecheck.IgnoreRequest.verify|verify} messages.
         * @function encode
         * @memberof languagecheck.IgnoreRequest
         * @static
         * @param {languagecheck.IIgnoreRequest} message IgnoreRequest message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        IgnoreRequest.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.message != null && Object.hasOwnProperty.call(message, "message"))
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.message);
            if (message.context != null && Object.hasOwnProperty.call(message, "context"))
                writer.uint32(/* id 2, wireType 2 =*/18).string(message.context);
            return writer;
        };

        /**
         * Encodes the specified IgnoreRequest message, length delimited. Does not implicitly {@link languagecheck.IgnoreRequest.verify|verify} messages.
         * @function encodeDelimited
         * @memberof languagecheck.IgnoreRequest
         * @static
         * @param {languagecheck.IIgnoreRequest} message IgnoreRequest message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        IgnoreRequest.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes an IgnoreRequest message from the specified reader or buffer.
         * @function decode
         * @memberof languagecheck.IgnoreRequest
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {languagecheck.IgnoreRequest} IgnoreRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        IgnoreRequest.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            var end = length === undefined ? reader.len : reader.pos + length, message = new $root.languagecheck.IgnoreRequest();
            while (reader.pos < end) {
                var tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.message = reader.string();
                        break;
                    }
                case 2: {
                        message.context = reader.string();
                        break;
                    }
                default:
                    reader.skipType(tag & 7);
                    break;
                }
            }
            return message;
        };

        /**
         * Decodes an IgnoreRequest message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof languagecheck.IgnoreRequest
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {languagecheck.IgnoreRequest} IgnoreRequest
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
        IgnoreRequest.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (message.message != null && message.hasOwnProperty("message"))
                if (!$util.isString(message.message))
                    return "message: string expected";
            if (message.context != null && message.hasOwnProperty("context"))
                if (!$util.isString(message.context))
                    return "context: string expected";
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
        IgnoreRequest.fromObject = function fromObject(object) {
            if (object instanceof $root.languagecheck.IgnoreRequest)
                return object;
            var message = new $root.languagecheck.IgnoreRequest();
            if (object.message != null)
                message.message = String(object.message);
            if (object.context != null)
                message.context = String(object.context);
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
        IgnoreRequest.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            var object = {};
            if (options.defaults) {
                object.message = "";
                object.context = "";
            }
            if (message.message != null && message.hasOwnProperty("message"))
                object.message = message.message;
            if (message.context != null && message.hasOwnProperty("context"))
                object.context = message.context;
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
         * Gets the default type url for IgnoreRequest
         * @function getTypeUrl
         * @memberof languagecheck.IgnoreRequest
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        IgnoreRequest.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/languagecheck.IgnoreRequest";
        };

        return IgnoreRequest;
    })();

    languagecheck.Response = (function() {

        /**
         * Properties of a Response.
         * @memberof languagecheck
         * @interface IResponse
         * @property {number|Long|null} [id] Response id
         * @property {languagecheck.ICheckResponse|null} [checkProse] Response checkProse
         * @property {languagecheck.IMetadataResponse|null} [getMetadata] Response getMetadata
         * @property {languagecheck.IErrorResponse|null} [error] Response error
         * @property {languagecheck.IOkResponse|null} [ok] Response ok
         */

        /**
         * Constructs a new Response.
         * @memberof languagecheck
         * @classdesc Represents a Response.
         * @implements IResponse
         * @constructor
         * @param {languagecheck.IResponse=} [properties] Properties to set
         */
        function Response(properties) {
            if (properties)
                for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
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
         * @member {languagecheck.ICheckResponse|null|undefined} checkProse
         * @memberof languagecheck.Response
         * @instance
         */
        Response.prototype.checkProse = null;

        /**
         * Response getMetadata.
         * @member {languagecheck.IMetadataResponse|null|undefined} getMetadata
         * @memberof languagecheck.Response
         * @instance
         */
        Response.prototype.getMetadata = null;

        /**
         * Response error.
         * @member {languagecheck.IErrorResponse|null|undefined} error
         * @memberof languagecheck.Response
         * @instance
         */
        Response.prototype.error = null;

        /**
         * Response ok.
         * @member {languagecheck.IOkResponse|null|undefined} ok
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
         * @param {languagecheck.IResponse=} [properties] Properties to set
         * @returns {languagecheck.Response} Response instance
         */
        Response.create = function create(properties) {
            return new Response(properties);
        };

        /**
         * Encodes the specified Response message. Does not implicitly {@link languagecheck.Response.verify|verify} messages.
         * @function encode
         * @memberof languagecheck.Response
         * @static
         * @param {languagecheck.IResponse} message Response message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Response.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.id != null && Object.hasOwnProperty.call(message, "id"))
                writer.uint32(/* id 1, wireType 0 =*/8).uint64(message.id);
            if (message.checkProse != null && Object.hasOwnProperty.call(message, "checkProse"))
                $root.languagecheck.CheckResponse.encode(message.checkProse, writer.uint32(/* id 2, wireType 2 =*/18).fork()).ldelim();
            if (message.getMetadata != null && Object.hasOwnProperty.call(message, "getMetadata"))
                $root.languagecheck.MetadataResponse.encode(message.getMetadata, writer.uint32(/* id 3, wireType 2 =*/26).fork()).ldelim();
            if (message.error != null && Object.hasOwnProperty.call(message, "error"))
                $root.languagecheck.ErrorResponse.encode(message.error, writer.uint32(/* id 4, wireType 2 =*/34).fork()).ldelim();
            if (message.ok != null && Object.hasOwnProperty.call(message, "ok"))
                $root.languagecheck.OkResponse.encode(message.ok, writer.uint32(/* id 5, wireType 2 =*/42).fork()).ldelim();
            return writer;
        };

        /**
         * Encodes the specified Response message, length delimited. Does not implicitly {@link languagecheck.Response.verify|verify} messages.
         * @function encodeDelimited
         * @memberof languagecheck.Response
         * @static
         * @param {languagecheck.IResponse} message Response message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Response.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a Response message from the specified reader or buffer.
         * @function decode
         * @memberof languagecheck.Response
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {languagecheck.Response} Response
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        Response.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            var end = length === undefined ? reader.len : reader.pos + length, message = new $root.languagecheck.Response();
            while (reader.pos < end) {
                var tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.id = reader.uint64();
                        break;
                    }
                case 2: {
                        message.checkProse = $root.languagecheck.CheckResponse.decode(reader, reader.uint32());
                        break;
                    }
                case 3: {
                        message.getMetadata = $root.languagecheck.MetadataResponse.decode(reader, reader.uint32());
                        break;
                    }
                case 4: {
                        message.error = $root.languagecheck.ErrorResponse.decode(reader, reader.uint32());
                        break;
                    }
                case 5: {
                        message.ok = $root.languagecheck.OkResponse.decode(reader, reader.uint32());
                        break;
                    }
                default:
                    reader.skipType(tag & 7);
                    break;
                }
            }
            return message;
        };

        /**
         * Decodes a Response message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof languagecheck.Response
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {languagecheck.Response} Response
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
        Response.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            var properties = {};
            if (message.id != null && message.hasOwnProperty("id"))
                if (!$util.isInteger(message.id) && !(message.id && $util.isInteger(message.id.low) && $util.isInteger(message.id.high)))
                    return "id: integer|Long expected";
            if (message.checkProse != null && message.hasOwnProperty("checkProse")) {
                properties.payload = 1;
                {
                    var error = $root.languagecheck.CheckResponse.verify(message.checkProse);
                    if (error)
                        return "checkProse." + error;
                }
            }
            if (message.getMetadata != null && message.hasOwnProperty("getMetadata")) {
                if (properties.payload === 1)
                    return "payload: multiple values";
                properties.payload = 1;
                {
                    var error = $root.languagecheck.MetadataResponse.verify(message.getMetadata);
                    if (error)
                        return "getMetadata." + error;
                }
            }
            if (message.error != null && message.hasOwnProperty("error")) {
                if (properties.payload === 1)
                    return "payload: multiple values";
                properties.payload = 1;
                {
                    var error = $root.languagecheck.ErrorResponse.verify(message.error);
                    if (error)
                        return "error." + error;
                }
            }
            if (message.ok != null && message.hasOwnProperty("ok")) {
                if (properties.payload === 1)
                    return "payload: multiple values";
                properties.payload = 1;
                {
                    var error = $root.languagecheck.OkResponse.verify(message.ok);
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
        Response.fromObject = function fromObject(object) {
            if (object instanceof $root.languagecheck.Response)
                return object;
            var message = new $root.languagecheck.Response();
            if (object.id != null)
                if ($util.Long)
                    (message.id = $util.Long.fromValue(object.id)).unsigned = true;
                else if (typeof object.id === "string")
                    message.id = parseInt(object.id, 10);
                else if (typeof object.id === "number")
                    message.id = object.id;
                else if (typeof object.id === "object")
                    message.id = new $util.LongBits(object.id.low >>> 0, object.id.high >>> 0).toNumber(true);
            if (object.checkProse != null) {
                if (typeof object.checkProse !== "object")
                    throw TypeError(".languagecheck.Response.checkProse: object expected");
                message.checkProse = $root.languagecheck.CheckResponse.fromObject(object.checkProse);
            }
            if (object.getMetadata != null) {
                if (typeof object.getMetadata !== "object")
                    throw TypeError(".languagecheck.Response.getMetadata: object expected");
                message.getMetadata = $root.languagecheck.MetadataResponse.fromObject(object.getMetadata);
            }
            if (object.error != null) {
                if (typeof object.error !== "object")
                    throw TypeError(".languagecheck.Response.error: object expected");
                message.error = $root.languagecheck.ErrorResponse.fromObject(object.error);
            }
            if (object.ok != null) {
                if (typeof object.ok !== "object")
                    throw TypeError(".languagecheck.Response.ok: object expected");
                message.ok = $root.languagecheck.OkResponse.fromObject(object.ok);
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
        Response.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            var object = {};
            if (options.defaults)
                if ($util.Long) {
                    var long = new $util.Long(0, 0, true);
                    object.id = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : long;
                } else
                    object.id = options.longs === String ? "0" : 0;
            if (message.id != null && message.hasOwnProperty("id"))
                if (typeof message.id === "number")
                    object.id = options.longs === String ? String(message.id) : message.id;
                else
                    object.id = options.longs === String ? $util.Long.prototype.toString.call(message.id) : options.longs === Number ? new $util.LongBits(message.id.low >>> 0, message.id.high >>> 0).toNumber(true) : message.id;
            if (message.checkProse != null && message.hasOwnProperty("checkProse")) {
                object.checkProse = $root.languagecheck.CheckResponse.toObject(message.checkProse, options);
                if (options.oneofs)
                    object.payload = "checkProse";
            }
            if (message.getMetadata != null && message.hasOwnProperty("getMetadata")) {
                object.getMetadata = $root.languagecheck.MetadataResponse.toObject(message.getMetadata, options);
                if (options.oneofs)
                    object.payload = "getMetadata";
            }
            if (message.error != null && message.hasOwnProperty("error")) {
                object.error = $root.languagecheck.ErrorResponse.toObject(message.error, options);
                if (options.oneofs)
                    object.payload = "error";
            }
            if (message.ok != null && message.hasOwnProperty("ok")) {
                object.ok = $root.languagecheck.OkResponse.toObject(message.ok, options);
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
         * Gets the default type url for Response
         * @function getTypeUrl
         * @memberof languagecheck.Response
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        Response.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/languagecheck.Response";
        };

        return Response;
    })();

    languagecheck.OkResponse = (function() {

        /**
         * Properties of an OkResponse.
         * @memberof languagecheck
         * @interface IOkResponse
         */

        /**
         * Constructs a new OkResponse.
         * @memberof languagecheck
         * @classdesc Represents an OkResponse.
         * @implements IOkResponse
         * @constructor
         * @param {languagecheck.IOkResponse=} [properties] Properties to set
         */
        function OkResponse(properties) {
            if (properties)
                for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * Creates a new OkResponse instance using the specified properties.
         * @function create
         * @memberof languagecheck.OkResponse
         * @static
         * @param {languagecheck.IOkResponse=} [properties] Properties to set
         * @returns {languagecheck.OkResponse} OkResponse instance
         */
        OkResponse.create = function create(properties) {
            return new OkResponse(properties);
        };

        /**
         * Encodes the specified OkResponse message. Does not implicitly {@link languagecheck.OkResponse.verify|verify} messages.
         * @function encode
         * @memberof languagecheck.OkResponse
         * @static
         * @param {languagecheck.IOkResponse} message OkResponse message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        OkResponse.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            return writer;
        };

        /**
         * Encodes the specified OkResponse message, length delimited. Does not implicitly {@link languagecheck.OkResponse.verify|verify} messages.
         * @function encodeDelimited
         * @memberof languagecheck.OkResponse
         * @static
         * @param {languagecheck.IOkResponse} message OkResponse message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        OkResponse.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes an OkResponse message from the specified reader or buffer.
         * @function decode
         * @memberof languagecheck.OkResponse
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {languagecheck.OkResponse} OkResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        OkResponse.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            var end = length === undefined ? reader.len : reader.pos + length, message = new $root.languagecheck.OkResponse();
            while (reader.pos < end) {
                var tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                default:
                    reader.skipType(tag & 7);
                    break;
                }
            }
            return message;
        };

        /**
         * Decodes an OkResponse message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof languagecheck.OkResponse
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {languagecheck.OkResponse} OkResponse
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
        OkResponse.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
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
        OkResponse.fromObject = function fromObject(object) {
            if (object instanceof $root.languagecheck.OkResponse)
                return object;
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
         * Gets the default type url for OkResponse
         * @function getTypeUrl
         * @memberof languagecheck.OkResponse
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        OkResponse.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/languagecheck.OkResponse";
        };

        return OkResponse;
    })();

    languagecheck.ErrorResponse = (function() {

        /**
         * Properties of an ErrorResponse.
         * @memberof languagecheck
         * @interface IErrorResponse
         * @property {string|null} [message] ErrorResponse message
         */

        /**
         * Constructs a new ErrorResponse.
         * @memberof languagecheck
         * @classdesc Represents an ErrorResponse.
         * @implements IErrorResponse
         * @constructor
         * @param {languagecheck.IErrorResponse=} [properties] Properties to set
         */
        function ErrorResponse(properties) {
            if (properties)
                for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
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
         * @param {languagecheck.IErrorResponse=} [properties] Properties to set
         * @returns {languagecheck.ErrorResponse} ErrorResponse instance
         */
        ErrorResponse.create = function create(properties) {
            return new ErrorResponse(properties);
        };

        /**
         * Encodes the specified ErrorResponse message. Does not implicitly {@link languagecheck.ErrorResponse.verify|verify} messages.
         * @function encode
         * @memberof languagecheck.ErrorResponse
         * @static
         * @param {languagecheck.IErrorResponse} message ErrorResponse message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        ErrorResponse.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.message != null && Object.hasOwnProperty.call(message, "message"))
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.message);
            return writer;
        };

        /**
         * Encodes the specified ErrorResponse message, length delimited. Does not implicitly {@link languagecheck.ErrorResponse.verify|verify} messages.
         * @function encodeDelimited
         * @memberof languagecheck.ErrorResponse
         * @static
         * @param {languagecheck.IErrorResponse} message ErrorResponse message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        ErrorResponse.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes an ErrorResponse message from the specified reader or buffer.
         * @function decode
         * @memberof languagecheck.ErrorResponse
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {languagecheck.ErrorResponse} ErrorResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        ErrorResponse.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            var end = length === undefined ? reader.len : reader.pos + length, message = new $root.languagecheck.ErrorResponse();
            while (reader.pos < end) {
                var tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.message = reader.string();
                        break;
                    }
                default:
                    reader.skipType(tag & 7);
                    break;
                }
            }
            return message;
        };

        /**
         * Decodes an ErrorResponse message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof languagecheck.ErrorResponse
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {languagecheck.ErrorResponse} ErrorResponse
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
        ErrorResponse.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
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
        ErrorResponse.fromObject = function fromObject(object) {
            if (object instanceof $root.languagecheck.ErrorResponse)
                return object;
            var message = new $root.languagecheck.ErrorResponse();
            if (object.message != null)
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
        ErrorResponse.toObject = function toObject(message, options) {
            if (!options)
                options = {};
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
         * Gets the default type url for ErrorResponse
         * @function getTypeUrl
         * @memberof languagecheck.ErrorResponse
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        ErrorResponse.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/languagecheck.ErrorResponse";
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
         * @memberof languagecheck
         * @interface ICheckRequest
         * @property {string|null} [text] CheckRequest text
         * @property {string|null} [languageId] CheckRequest languageId
         * @property {Object.<string,string>|null} [settings] CheckRequest settings
         * @property {string|null} [filePath] CheckRequest filePath
         */

        /**
         * Constructs a new CheckRequest.
         * @memberof languagecheck
         * @classdesc Represents a CheckRequest.
         * @implements ICheckRequest
         * @constructor
         * @param {languagecheck.ICheckRequest=} [properties] Properties to set
         */
        function CheckRequest(properties) {
            this.settings = {};
            if (properties)
                for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
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
         * @param {languagecheck.ICheckRequest=} [properties] Properties to set
         * @returns {languagecheck.CheckRequest} CheckRequest instance
         */
        CheckRequest.create = function create(properties) {
            return new CheckRequest(properties);
        };

        /**
         * Encodes the specified CheckRequest message. Does not implicitly {@link languagecheck.CheckRequest.verify|verify} messages.
         * @function encode
         * @memberof languagecheck.CheckRequest
         * @static
         * @param {languagecheck.ICheckRequest} message CheckRequest message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        CheckRequest.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.text != null && Object.hasOwnProperty.call(message, "text"))
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.text);
            if (message.languageId != null && Object.hasOwnProperty.call(message, "languageId"))
                writer.uint32(/* id 2, wireType 2 =*/18).string(message.languageId);
            if (message.settings != null && Object.hasOwnProperty.call(message, "settings"))
                for (var keys = Object.keys(message.settings), i = 0; i < keys.length; ++i)
                    writer.uint32(/* id 3, wireType 2 =*/26).fork().uint32(/* id 1, wireType 2 =*/10).string(keys[i]).uint32(/* id 2, wireType 2 =*/18).string(message.settings[keys[i]]).ldelim();
            if (message.filePath != null && Object.hasOwnProperty.call(message, "filePath"))
                writer.uint32(/* id 4, wireType 2 =*/34).string(message.filePath);
            return writer;
        };

        /**
         * Encodes the specified CheckRequest message, length delimited. Does not implicitly {@link languagecheck.CheckRequest.verify|verify} messages.
         * @function encodeDelimited
         * @memberof languagecheck.CheckRequest
         * @static
         * @param {languagecheck.ICheckRequest} message CheckRequest message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        CheckRequest.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a CheckRequest message from the specified reader or buffer.
         * @function decode
         * @memberof languagecheck.CheckRequest
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {languagecheck.CheckRequest} CheckRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        CheckRequest.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            var end = length === undefined ? reader.len : reader.pos + length, message = new $root.languagecheck.CheckRequest(), key, value;
            while (reader.pos < end) {
                var tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.text = reader.string();
                        break;
                    }
                case 2: {
                        message.languageId = reader.string();
                        break;
                    }
                case 3: {
                        if (message.settings === $util.emptyObject)
                            message.settings = {};
                        var end2 = reader.uint32() + reader.pos;
                        key = "";
                        value = "";
                        while (reader.pos < end2) {
                            var tag2 = reader.uint32();
                            switch (tag2 >>> 3) {
                            case 1:
                                key = reader.string();
                                break;
                            case 2:
                                value = reader.string();
                                break;
                            default:
                                reader.skipType(tag2 & 7);
                                break;
                            }
                        }
                        message.settings[key] = value;
                        break;
                    }
                case 4: {
                        message.filePath = reader.string();
                        break;
                    }
                default:
                    reader.skipType(tag & 7);
                    break;
                }
            }
            return message;
        };

        /**
         * Decodes a CheckRequest message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof languagecheck.CheckRequest
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {languagecheck.CheckRequest} CheckRequest
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
        CheckRequest.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
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
        CheckRequest.fromObject = function fromObject(object) {
            if (object instanceof $root.languagecheck.CheckRequest)
                return object;
            var message = new $root.languagecheck.CheckRequest();
            if (object.text != null)
                message.text = String(object.text);
            if (object.languageId != null)
                message.languageId = String(object.languageId);
            if (object.settings) {
                if (typeof object.settings !== "object")
                    throw TypeError(".languagecheck.CheckRequest.settings: object expected");
                message.settings = {};
                for (var keys = Object.keys(object.settings), i = 0; i < keys.length; ++i)
                    message.settings[keys[i]] = String(object.settings[keys[i]]);
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
        CheckRequest.toObject = function toObject(message, options) {
            if (!options)
                options = {};
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
                for (var j = 0; j < keys2.length; ++j)
                    object.settings[keys2[j]] = message.settings[keys2[j]];
            }
            if (message.filePath != null && message.hasOwnProperty("filePath")) {
                object.filePath = message.filePath;
                if (options.oneofs)
                    object._filePath = "filePath";
            }
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
         * Gets the default type url for CheckRequest
         * @function getTypeUrl
         * @memberof languagecheck.CheckRequest
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        CheckRequest.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/languagecheck.CheckRequest";
        };

        return CheckRequest;
    })();

    languagecheck.CheckResponse = (function() {

        /**
         * Properties of a CheckResponse.
         * @memberof languagecheck
         * @interface ICheckResponse
         * @property {Array.<languagecheck.IDiagnostic>|null} [diagnostics] CheckResponse diagnostics
         */

        /**
         * Constructs a new CheckResponse.
         * @memberof languagecheck
         * @classdesc Represents a CheckResponse.
         * @implements ICheckResponse
         * @constructor
         * @param {languagecheck.ICheckResponse=} [properties] Properties to set
         */
        function CheckResponse(properties) {
            this.diagnostics = [];
            if (properties)
                for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * CheckResponse diagnostics.
         * @member {Array.<languagecheck.IDiagnostic>} diagnostics
         * @memberof languagecheck.CheckResponse
         * @instance
         */
        CheckResponse.prototype.diagnostics = $util.emptyArray;

        /**
         * Creates a new CheckResponse instance using the specified properties.
         * @function create
         * @memberof languagecheck.CheckResponse
         * @static
         * @param {languagecheck.ICheckResponse=} [properties] Properties to set
         * @returns {languagecheck.CheckResponse} CheckResponse instance
         */
        CheckResponse.create = function create(properties) {
            return new CheckResponse(properties);
        };

        /**
         * Encodes the specified CheckResponse message. Does not implicitly {@link languagecheck.CheckResponse.verify|verify} messages.
         * @function encode
         * @memberof languagecheck.CheckResponse
         * @static
         * @param {languagecheck.ICheckResponse} message CheckResponse message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        CheckResponse.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.diagnostics != null && message.diagnostics.length)
                for (var i = 0; i < message.diagnostics.length; ++i)
                    $root.languagecheck.Diagnostic.encode(message.diagnostics[i], writer.uint32(/* id 1, wireType 2 =*/10).fork()).ldelim();
            return writer;
        };

        /**
         * Encodes the specified CheckResponse message, length delimited. Does not implicitly {@link languagecheck.CheckResponse.verify|verify} messages.
         * @function encodeDelimited
         * @memberof languagecheck.CheckResponse
         * @static
         * @param {languagecheck.ICheckResponse} message CheckResponse message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        CheckResponse.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a CheckResponse message from the specified reader or buffer.
         * @function decode
         * @memberof languagecheck.CheckResponse
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {languagecheck.CheckResponse} CheckResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        CheckResponse.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            var end = length === undefined ? reader.len : reader.pos + length, message = new $root.languagecheck.CheckResponse();
            while (reader.pos < end) {
                var tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        if (!(message.diagnostics && message.diagnostics.length))
                            message.diagnostics = [];
                        message.diagnostics.push($root.languagecheck.Diagnostic.decode(reader, reader.uint32()));
                        break;
                    }
                default:
                    reader.skipType(tag & 7);
                    break;
                }
            }
            return message;
        };

        /**
         * Decodes a CheckResponse message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof languagecheck.CheckResponse
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {languagecheck.CheckResponse} CheckResponse
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
        CheckResponse.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (message.diagnostics != null && message.hasOwnProperty("diagnostics")) {
                if (!Array.isArray(message.diagnostics))
                    return "diagnostics: array expected";
                for (var i = 0; i < message.diagnostics.length; ++i) {
                    var error = $root.languagecheck.Diagnostic.verify(message.diagnostics[i]);
                    if (error)
                        return "diagnostics." + error;
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
        CheckResponse.fromObject = function fromObject(object) {
            if (object instanceof $root.languagecheck.CheckResponse)
                return object;
            var message = new $root.languagecheck.CheckResponse();
            if (object.diagnostics) {
                if (!Array.isArray(object.diagnostics))
                    throw TypeError(".languagecheck.CheckResponse.diagnostics: array expected");
                message.diagnostics = [];
                for (var i = 0; i < object.diagnostics.length; ++i) {
                    if (typeof object.diagnostics[i] !== "object")
                        throw TypeError(".languagecheck.CheckResponse.diagnostics: object expected");
                    message.diagnostics[i] = $root.languagecheck.Diagnostic.fromObject(object.diagnostics[i]);
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
        CheckResponse.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            var object = {};
            if (options.arrays || options.defaults)
                object.diagnostics = [];
            if (message.diagnostics && message.diagnostics.length) {
                object.diagnostics = [];
                for (var j = 0; j < message.diagnostics.length; ++j)
                    object.diagnostics[j] = $root.languagecheck.Diagnostic.toObject(message.diagnostics[j], options);
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
         * Gets the default type url for CheckResponse
         * @function getTypeUrl
         * @memberof languagecheck.CheckResponse
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        CheckResponse.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/languagecheck.CheckResponse";
        };

        return CheckResponse;
    })();

    languagecheck.Diagnostic = (function() {

        /**
         * Properties of a Diagnostic.
         * @memberof languagecheck
         * @interface IDiagnostic
         * @property {number|null} [startByte] Diagnostic startByte
         * @property {number|null} [endByte] Diagnostic endByte
         * @property {string|null} [message] Diagnostic message
         * @property {Array.<string>|null} [suggestions] Diagnostic suggestions
         * @property {string|null} [ruleId] Diagnostic ruleId
         * @property {languagecheck.Severity|null} [severity] Diagnostic severity
         * @property {string|null} [unifiedId] Diagnostic unifiedId
         * @property {number|null} [confidence] Diagnostic confidence
         */

        /**
         * Constructs a new Diagnostic.
         * @memberof languagecheck
         * @classdesc Represents a Diagnostic.
         * @implements IDiagnostic
         * @constructor
         * @param {languagecheck.IDiagnostic=} [properties] Properties to set
         */
        function Diagnostic(properties) {
            this.suggestions = [];
            if (properties)
                for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
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
         * @param {languagecheck.IDiagnostic=} [properties] Properties to set
         * @returns {languagecheck.Diagnostic} Diagnostic instance
         */
        Diagnostic.create = function create(properties) {
            return new Diagnostic(properties);
        };

        /**
         * Encodes the specified Diagnostic message. Does not implicitly {@link languagecheck.Diagnostic.verify|verify} messages.
         * @function encode
         * @memberof languagecheck.Diagnostic
         * @static
         * @param {languagecheck.IDiagnostic} message Diagnostic message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Diagnostic.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
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
            return writer;
        };

        /**
         * Encodes the specified Diagnostic message, length delimited. Does not implicitly {@link languagecheck.Diagnostic.verify|verify} messages.
         * @function encodeDelimited
         * @memberof languagecheck.Diagnostic
         * @static
         * @param {languagecheck.IDiagnostic} message Diagnostic message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Diagnostic.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a Diagnostic message from the specified reader or buffer.
         * @function decode
         * @memberof languagecheck.Diagnostic
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {languagecheck.Diagnostic} Diagnostic
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        Diagnostic.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            var end = length === undefined ? reader.len : reader.pos + length, message = new $root.languagecheck.Diagnostic();
            while (reader.pos < end) {
                var tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.startByte = reader.uint32();
                        break;
                    }
                case 2: {
                        message.endByte = reader.uint32();
                        break;
                    }
                case 3: {
                        message.message = reader.string();
                        break;
                    }
                case 4: {
                        if (!(message.suggestions && message.suggestions.length))
                            message.suggestions = [];
                        message.suggestions.push(reader.string());
                        break;
                    }
                case 5: {
                        message.ruleId = reader.string();
                        break;
                    }
                case 6: {
                        message.severity = reader.int32();
                        break;
                    }
                case 7: {
                        message.unifiedId = reader.string();
                        break;
                    }
                case 8: {
                        message.confidence = reader.float();
                        break;
                    }
                default:
                    reader.skipType(tag & 7);
                    break;
                }
            }
            return message;
        };

        /**
         * Decodes a Diagnostic message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof languagecheck.Diagnostic
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {languagecheck.Diagnostic} Diagnostic
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
        Diagnostic.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
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
        Diagnostic.fromObject = function fromObject(object) {
            if (object instanceof $root.languagecheck.Diagnostic)
                return object;
            var message = new $root.languagecheck.Diagnostic();
            if (object.startByte != null)
                message.startByte = object.startByte >>> 0;
            if (object.endByte != null)
                message.endByte = object.endByte >>> 0;
            if (object.message != null)
                message.message = String(object.message);
            if (object.suggestions) {
                if (!Array.isArray(object.suggestions))
                    throw TypeError(".languagecheck.Diagnostic.suggestions: array expected");
                message.suggestions = [];
                for (var i = 0; i < object.suggestions.length; ++i)
                    message.suggestions[i] = String(object.suggestions[i]);
            }
            if (object.ruleId != null)
                message.ruleId = String(object.ruleId);
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
                message.unifiedId = String(object.unifiedId);
            if (object.confidence != null)
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
        Diagnostic.toObject = function toObject(message, options) {
            if (!options)
                options = {};
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
                object.suggestions = [];
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
         * Gets the default type url for Diagnostic
         * @function getTypeUrl
         * @memberof languagecheck.Diagnostic
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        Diagnostic.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/languagecheck.Diagnostic";
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

    languagecheck.MetadataRequest = (function() {

        /**
         * Properties of a MetadataRequest.
         * @memberof languagecheck
         * @interface IMetadataRequest
         */

        /**
         * Constructs a new MetadataRequest.
         * @memberof languagecheck
         * @classdesc Represents a MetadataRequest.
         * @implements IMetadataRequest
         * @constructor
         * @param {languagecheck.IMetadataRequest=} [properties] Properties to set
         */
        function MetadataRequest(properties) {
            if (properties)
                for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * Creates a new MetadataRequest instance using the specified properties.
         * @function create
         * @memberof languagecheck.MetadataRequest
         * @static
         * @param {languagecheck.IMetadataRequest=} [properties] Properties to set
         * @returns {languagecheck.MetadataRequest} MetadataRequest instance
         */
        MetadataRequest.create = function create(properties) {
            return new MetadataRequest(properties);
        };

        /**
         * Encodes the specified MetadataRequest message. Does not implicitly {@link languagecheck.MetadataRequest.verify|verify} messages.
         * @function encode
         * @memberof languagecheck.MetadataRequest
         * @static
         * @param {languagecheck.IMetadataRequest} message MetadataRequest message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        MetadataRequest.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            return writer;
        };

        /**
         * Encodes the specified MetadataRequest message, length delimited. Does not implicitly {@link languagecheck.MetadataRequest.verify|verify} messages.
         * @function encodeDelimited
         * @memberof languagecheck.MetadataRequest
         * @static
         * @param {languagecheck.IMetadataRequest} message MetadataRequest message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        MetadataRequest.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a MetadataRequest message from the specified reader or buffer.
         * @function decode
         * @memberof languagecheck.MetadataRequest
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {languagecheck.MetadataRequest} MetadataRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        MetadataRequest.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            var end = length === undefined ? reader.len : reader.pos + length, message = new $root.languagecheck.MetadataRequest();
            while (reader.pos < end) {
                var tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                default:
                    reader.skipType(tag & 7);
                    break;
                }
            }
            return message;
        };

        /**
         * Decodes a MetadataRequest message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof languagecheck.MetadataRequest
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {languagecheck.MetadataRequest} MetadataRequest
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
        MetadataRequest.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
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
        MetadataRequest.fromObject = function fromObject(object) {
            if (object instanceof $root.languagecheck.MetadataRequest)
                return object;
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
         * Gets the default type url for MetadataRequest
         * @function getTypeUrl
         * @memberof languagecheck.MetadataRequest
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        MetadataRequest.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/languagecheck.MetadataRequest";
        };

        return MetadataRequest;
    })();

    languagecheck.MetadataResponse = (function() {

        /**
         * Properties of a MetadataResponse.
         * @memberof languagecheck
         * @interface IMetadataResponse
         * @property {string|null} [name] MetadataResponse name
         * @property {string|null} [version] MetadataResponse version
         * @property {Array.<string>|null} [supportedLanguages] MetadataResponse supportedLanguages
         */

        /**
         * Constructs a new MetadataResponse.
         * @memberof languagecheck
         * @classdesc Represents a MetadataResponse.
         * @implements IMetadataResponse
         * @constructor
         * @param {languagecheck.IMetadataResponse=} [properties] Properties to set
         */
        function MetadataResponse(properties) {
            this.supportedLanguages = [];
            if (properties)
                for (var keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
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
         * Creates a new MetadataResponse instance using the specified properties.
         * @function create
         * @memberof languagecheck.MetadataResponse
         * @static
         * @param {languagecheck.IMetadataResponse=} [properties] Properties to set
         * @returns {languagecheck.MetadataResponse} MetadataResponse instance
         */
        MetadataResponse.create = function create(properties) {
            return new MetadataResponse(properties);
        };

        /**
         * Encodes the specified MetadataResponse message. Does not implicitly {@link languagecheck.MetadataResponse.verify|verify} messages.
         * @function encode
         * @memberof languagecheck.MetadataResponse
         * @static
         * @param {languagecheck.IMetadataResponse} message MetadataResponse message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        MetadataResponse.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.name != null && Object.hasOwnProperty.call(message, "name"))
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.name);
            if (message.version != null && Object.hasOwnProperty.call(message, "version"))
                writer.uint32(/* id 2, wireType 2 =*/18).string(message.version);
            if (message.supportedLanguages != null && message.supportedLanguages.length)
                for (var i = 0; i < message.supportedLanguages.length; ++i)
                    writer.uint32(/* id 3, wireType 2 =*/26).string(message.supportedLanguages[i]);
            return writer;
        };

        /**
         * Encodes the specified MetadataResponse message, length delimited. Does not implicitly {@link languagecheck.MetadataResponse.verify|verify} messages.
         * @function encodeDelimited
         * @memberof languagecheck.MetadataResponse
         * @static
         * @param {languagecheck.IMetadataResponse} message MetadataResponse message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        MetadataResponse.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a MetadataResponse message from the specified reader or buffer.
         * @function decode
         * @memberof languagecheck.MetadataResponse
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {languagecheck.MetadataResponse} MetadataResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        MetadataResponse.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            var end = length === undefined ? reader.len : reader.pos + length, message = new $root.languagecheck.MetadataResponse();
            while (reader.pos < end) {
                var tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.name = reader.string();
                        break;
                    }
                case 2: {
                        message.version = reader.string();
                        break;
                    }
                case 3: {
                        if (!(message.supportedLanguages && message.supportedLanguages.length))
                            message.supportedLanguages = [];
                        message.supportedLanguages.push(reader.string());
                        break;
                    }
                default:
                    reader.skipType(tag & 7);
                    break;
                }
            }
            return message;
        };

        /**
         * Decodes a MetadataResponse message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof languagecheck.MetadataResponse
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {languagecheck.MetadataResponse} MetadataResponse
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
        MetadataResponse.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
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
        MetadataResponse.fromObject = function fromObject(object) {
            if (object instanceof $root.languagecheck.MetadataResponse)
                return object;
            var message = new $root.languagecheck.MetadataResponse();
            if (object.name != null)
                message.name = String(object.name);
            if (object.version != null)
                message.version = String(object.version);
            if (object.supportedLanguages) {
                if (!Array.isArray(object.supportedLanguages))
                    throw TypeError(".languagecheck.MetadataResponse.supportedLanguages: array expected");
                message.supportedLanguages = [];
                for (var i = 0; i < object.supportedLanguages.length; ++i)
                    message.supportedLanguages[i] = String(object.supportedLanguages[i]);
            }
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
        MetadataResponse.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            var object = {};
            if (options.arrays || options.defaults)
                object.supportedLanguages = [];
            if (options.defaults) {
                object.name = "";
                object.version = "";
            }
            if (message.name != null && message.hasOwnProperty("name"))
                object.name = message.name;
            if (message.version != null && message.hasOwnProperty("version"))
                object.version = message.version;
            if (message.supportedLanguages && message.supportedLanguages.length) {
                object.supportedLanguages = [];
                for (var j = 0; j < message.supportedLanguages.length; ++j)
                    object.supportedLanguages[j] = message.supportedLanguages[j];
            }
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
         * Gets the default type url for MetadataResponse
         * @function getTypeUrl
         * @memberof languagecheck.MetadataResponse
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        MetadataResponse.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/languagecheck.MetadataResponse";
        };

        return MetadataResponse;
    })();

    return languagecheck;
})();

module.exports = $root;
