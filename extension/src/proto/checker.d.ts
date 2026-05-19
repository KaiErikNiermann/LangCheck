import * as $protobuf from "protobufjs";
import Long = require("long");

/** Namespace languagecheck. */
export namespace languagecheck {

    /**
     * Properties of a Request.
     * @deprecated Use languagecheck.Request.$Properties instead.
     */
    interface IRequest extends languagecheck.Request.$Properties {
    }

    /** Represents a Request. */
    class Request {

        /**
         * Constructs a new Request.
         * @param [properties] Properties to set
         */
        constructor(properties?: languagecheck.Request.$Properties);

        /** Unknown fields preserved while decoding */
        $unknowns?: Uint8Array[];

        /** Request id. */
        id: (number|Long);

        /** Request checkProse. */
        checkProse?: (languagecheck.CheckRequest.$Properties|null);

        /** Request getMetadata. */
        getMetadata?: (languagecheck.MetadataRequest.$Properties|null);

        /** Request ignore. */
        ignore?: (languagecheck.IgnoreRequest.$Properties|null);

        /** Request initialize. */
        initialize?: (languagecheck.InitializeRequest.$Properties|null);

        /** Request addDictionaryWord. */
        addDictionaryWord?: (languagecheck.AddDictionaryWordRequest.$Properties|null);

        /** Request payload. */
        payload?: ("checkProse"|"getMetadata"|"ignore"|"initialize"|"addDictionaryWord");

        /**
         * Creates a new Request instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Request instance
         */
        static create(properties: languagecheck.Request.$Shape): languagecheck.Request & languagecheck.Request.$Shape;
        static create(properties?: languagecheck.Request.$Properties): languagecheck.Request;

        /**
         * Encodes the specified Request message. Does not implicitly {@link languagecheck.Request.verify|verify} messages.
         * @param message Request message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: languagecheck.Request.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Request message, length delimited. Does not implicitly {@link languagecheck.Request.verify|verify} messages.
         * @param message Request message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encodeDelimited(message: languagecheck.Request.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Request message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {languagecheck.Request & languagecheck.Request.$Shape} Request
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): languagecheck.Request & languagecheck.Request.$Shape;

        /**
         * Decodes a Request message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns {languagecheck.Request & languagecheck.Request.$Shape} Request
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): languagecheck.Request & languagecheck.Request.$Shape;

        /**
         * Verifies a Request message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a Request message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Request
         */
        static fromObject(object: { [k: string]: any }): languagecheck.Request;

        /**
         * Creates a plain object from a Request message. Also converts values to other types if specified.
         * @param message Request
         * @param [options] Conversion options
         * @returns Plain object
         */
        static toObject(message: languagecheck.Request, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Request to JSON.
         * @returns JSON object
         */
        toJSON(): { [k: string]: any };

        /**
         * Gets the type url for Request
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace Request {

        /** Properties of a Request. */
        interface $Properties {

            /** Request id */
            id?: (number|Long|null);

            /** Request checkProse */
            checkProse?: (languagecheck.CheckRequest.$Properties|null);

            /** Request getMetadata */
            getMetadata?: (languagecheck.MetadataRequest.$Properties|null);

            /** Request ignore */
            ignore?: (languagecheck.IgnoreRequest.$Properties|null);

            /** Request initialize */
            initialize?: (languagecheck.InitializeRequest.$Properties|null);

            /** Request addDictionaryWord */
            addDictionaryWord?: (languagecheck.AddDictionaryWordRequest.$Properties|null);

            /** Request payload */
            payload?: ("checkProse"|"getMetadata"|"ignore"|"initialize"|"addDictionaryWord");

            /** Unknown fields preserved while decoding */
            $unknowns?: Uint8Array[];
        }

        /** Narrowed shape of a Request. */
        type $Shape = {
  id?: number|Long|null;
  checkProse?: languagecheck.CheckRequest.$Shape|null;
  getMetadata?: languagecheck.MetadataRequest.$Shape|null;
  ignore?: languagecheck.IgnoreRequest.$Shape|null;
  initialize?: languagecheck.InitializeRequest.$Shape|null;
  addDictionaryWord?: languagecheck.AddDictionaryWordRequest.$Shape|null;
  $unknowns?: Uint8Array[];
} & (
  ({ payload?: undefined; checkProse?: null; getMetadata?: null; ignore?: null; initialize?: null; addDictionaryWord?: null }|{ payload?: "checkProse"; checkProse: languagecheck.CheckRequest.$Shape; getMetadata?: null; ignore?: null; initialize?: null; addDictionaryWord?: null }|{ payload?: "getMetadata"; checkProse?: null; getMetadata: languagecheck.MetadataRequest.$Shape; ignore?: null; initialize?: null; addDictionaryWord?: null }|{ payload?: "ignore"; checkProse?: null; getMetadata?: null; ignore: languagecheck.IgnoreRequest.$Shape; initialize?: null; addDictionaryWord?: null }|{ payload?: "initialize"; checkProse?: null; getMetadata?: null; ignore?: null; initialize: languagecheck.InitializeRequest.$Shape; addDictionaryWord?: null }|{ payload?: "addDictionaryWord"; checkProse?: null; getMetadata?: null; ignore?: null; initialize?: null; addDictionaryWord: languagecheck.AddDictionaryWordRequest.$Shape })
);
    }

    /**
     * Properties of an InitializeRequest.
     * @deprecated Use languagecheck.InitializeRequest.$Properties instead.
     */
    interface IInitializeRequest extends languagecheck.InitializeRequest.$Properties {
    }

    /** Represents an InitializeRequest. */
    class InitializeRequest {

        /**
         * Constructs a new InitializeRequest.
         * @param [properties] Properties to set
         */
        constructor(properties?: languagecheck.InitializeRequest.$Properties);

        /** Unknown fields preserved while decoding */
        $unknowns?: Uint8Array[];

        /** InitializeRequest workspaceRoot. */
        workspaceRoot: string;

        /** InitializeRequest indexOnOpen. */
        indexOnOpen?: (boolean|null);

        /** InitializeRequest dbPath. */
        dbPath?: (string|null);

        /**
         * Creates a new InitializeRequest instance using the specified properties.
         * @param [properties] Properties to set
         * @returns InitializeRequest instance
         */
        static create(properties: languagecheck.InitializeRequest.$Shape): languagecheck.InitializeRequest & languagecheck.InitializeRequest.$Shape;
        static create(properties?: languagecheck.InitializeRequest.$Properties): languagecheck.InitializeRequest;

        /**
         * Encodes the specified InitializeRequest message. Does not implicitly {@link languagecheck.InitializeRequest.verify|verify} messages.
         * @param message InitializeRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: languagecheck.InitializeRequest.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified InitializeRequest message, length delimited. Does not implicitly {@link languagecheck.InitializeRequest.verify|verify} messages.
         * @param message InitializeRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encodeDelimited(message: languagecheck.InitializeRequest.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an InitializeRequest message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {languagecheck.InitializeRequest & languagecheck.InitializeRequest.$Shape} InitializeRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): languagecheck.InitializeRequest & languagecheck.InitializeRequest.$Shape;

        /**
         * Decodes an InitializeRequest message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns {languagecheck.InitializeRequest & languagecheck.InitializeRequest.$Shape} InitializeRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): languagecheck.InitializeRequest & languagecheck.InitializeRequest.$Shape;

        /**
         * Verifies an InitializeRequest message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an InitializeRequest message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns InitializeRequest
         */
        static fromObject(object: { [k: string]: any }): languagecheck.InitializeRequest;

        /**
         * Creates a plain object from an InitializeRequest message. Also converts values to other types if specified.
         * @param message InitializeRequest
         * @param [options] Conversion options
         * @returns Plain object
         */
        static toObject(message: languagecheck.InitializeRequest, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this InitializeRequest to JSON.
         * @returns JSON object
         */
        toJSON(): { [k: string]: any };

        /**
         * Gets the type url for InitializeRequest
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace InitializeRequest {

        /** Properties of an InitializeRequest. */
        interface $Properties {

            /** InitializeRequest workspaceRoot */
            workspaceRoot?: (string|null);

            /** InitializeRequest indexOnOpen */
            indexOnOpen?: (boolean|null);

            /** InitializeRequest dbPath */
            dbPath?: (string|null);

            /** Unknown fields preserved while decoding */
            $unknowns?: Uint8Array[];
        }

        /** Shape of an InitializeRequest. */
        type $Shape = languagecheck.InitializeRequest.$Properties;
    }

    /**
     * Properties of an IgnoreRequest.
     * @deprecated Use languagecheck.IgnoreRequest.$Properties instead.
     */
    interface IIgnoreRequest extends languagecheck.IgnoreRequest.$Properties {
    }

    /** Represents an IgnoreRequest. */
    class IgnoreRequest {

        /**
         * Constructs a new IgnoreRequest.
         * @param [properties] Properties to set
         */
        constructor(properties?: languagecheck.IgnoreRequest.$Properties);

        /** Unknown fields preserved while decoding */
        $unknowns?: Uint8Array[];

        /** IgnoreRequest message. */
        message: string;

        /** IgnoreRequest context. */
        context: string;

        /** IgnoreRequest text. */
        text: string;

        /** IgnoreRequest startByte. */
        startByte: number;

        /** IgnoreRequest endByte. */
        endByte: number;

        /**
         * Creates a new IgnoreRequest instance using the specified properties.
         * @param [properties] Properties to set
         * @returns IgnoreRequest instance
         */
        static create(properties: languagecheck.IgnoreRequest.$Shape): languagecheck.IgnoreRequest & languagecheck.IgnoreRequest.$Shape;
        static create(properties?: languagecheck.IgnoreRequest.$Properties): languagecheck.IgnoreRequest;

        /**
         * Encodes the specified IgnoreRequest message. Does not implicitly {@link languagecheck.IgnoreRequest.verify|verify} messages.
         * @param message IgnoreRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: languagecheck.IgnoreRequest.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified IgnoreRequest message, length delimited. Does not implicitly {@link languagecheck.IgnoreRequest.verify|verify} messages.
         * @param message IgnoreRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encodeDelimited(message: languagecheck.IgnoreRequest.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an IgnoreRequest message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {languagecheck.IgnoreRequest & languagecheck.IgnoreRequest.$Shape} IgnoreRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): languagecheck.IgnoreRequest & languagecheck.IgnoreRequest.$Shape;

        /**
         * Decodes an IgnoreRequest message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns {languagecheck.IgnoreRequest & languagecheck.IgnoreRequest.$Shape} IgnoreRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): languagecheck.IgnoreRequest & languagecheck.IgnoreRequest.$Shape;

        /**
         * Verifies an IgnoreRequest message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an IgnoreRequest message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns IgnoreRequest
         */
        static fromObject(object: { [k: string]: any }): languagecheck.IgnoreRequest;

        /**
         * Creates a plain object from an IgnoreRequest message. Also converts values to other types if specified.
         * @param message IgnoreRequest
         * @param [options] Conversion options
         * @returns Plain object
         */
        static toObject(message: languagecheck.IgnoreRequest, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this IgnoreRequest to JSON.
         * @returns JSON object
         */
        toJSON(): { [k: string]: any };

        /**
         * Gets the type url for IgnoreRequest
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace IgnoreRequest {

        /** Properties of an IgnoreRequest. */
        interface $Properties {

            /** IgnoreRequest message */
            message?: (string|null);

            /** IgnoreRequest context */
            context?: (string|null);

            /** IgnoreRequest text */
            text?: (string|null);

            /** IgnoreRequest startByte */
            startByte?: (number|null);

            /** IgnoreRequest endByte */
            endByte?: (number|null);

            /** Unknown fields preserved while decoding */
            $unknowns?: Uint8Array[];
        }

        /** Shape of an IgnoreRequest. */
        type $Shape = languagecheck.IgnoreRequest.$Properties;
    }

    /**
     * Properties of a Response.
     * @deprecated Use languagecheck.Response.$Properties instead.
     */
    interface IResponse extends languagecheck.Response.$Properties {
    }

    /** Represents a Response. */
    class Response {

        /**
         * Constructs a new Response.
         * @param [properties] Properties to set
         */
        constructor(properties?: languagecheck.Response.$Properties);

        /** Unknown fields preserved while decoding */
        $unknowns?: Uint8Array[];

        /** Response id. */
        id: (number|Long);

        /** Response checkProse. */
        checkProse?: (languagecheck.CheckResponse.$Properties|null);

        /** Response getMetadata. */
        getMetadata?: (languagecheck.MetadataResponse.$Properties|null);

        /** Response error. */
        error?: (languagecheck.ErrorResponse.$Properties|null);

        /** Response ok. */
        ok?: (languagecheck.OkResponse.$Properties|null);

        /** Response payload. */
        payload?: ("checkProse"|"getMetadata"|"error"|"ok");

        /**
         * Creates a new Response instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Response instance
         */
        static create(properties: languagecheck.Response.$Shape): languagecheck.Response & languagecheck.Response.$Shape;
        static create(properties?: languagecheck.Response.$Properties): languagecheck.Response;

        /**
         * Encodes the specified Response message. Does not implicitly {@link languagecheck.Response.verify|verify} messages.
         * @param message Response message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: languagecheck.Response.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Response message, length delimited. Does not implicitly {@link languagecheck.Response.verify|verify} messages.
         * @param message Response message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encodeDelimited(message: languagecheck.Response.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Response message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {languagecheck.Response & languagecheck.Response.$Shape} Response
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): languagecheck.Response & languagecheck.Response.$Shape;

        /**
         * Decodes a Response message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns {languagecheck.Response & languagecheck.Response.$Shape} Response
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): languagecheck.Response & languagecheck.Response.$Shape;

        /**
         * Verifies a Response message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a Response message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Response
         */
        static fromObject(object: { [k: string]: any }): languagecheck.Response;

        /**
         * Creates a plain object from a Response message. Also converts values to other types if specified.
         * @param message Response
         * @param [options] Conversion options
         * @returns Plain object
         */
        static toObject(message: languagecheck.Response, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Response to JSON.
         * @returns JSON object
         */
        toJSON(): { [k: string]: any };

        /**
         * Gets the type url for Response
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace Response {

        /** Properties of a Response. */
        interface $Properties {

            /** Response id */
            id?: (number|Long|null);

            /** Response checkProse */
            checkProse?: (languagecheck.CheckResponse.$Properties|null);

            /** Response getMetadata */
            getMetadata?: (languagecheck.MetadataResponse.$Properties|null);

            /** Response error */
            error?: (languagecheck.ErrorResponse.$Properties|null);

            /** Response ok */
            ok?: (languagecheck.OkResponse.$Properties|null);

            /** Response payload */
            payload?: ("checkProse"|"getMetadata"|"error"|"ok");

            /** Unknown fields preserved while decoding */
            $unknowns?: Uint8Array[];
        }

        /** Narrowed shape of a Response. */
        type $Shape = {
  id?: number|Long|null;
  checkProse?: languagecheck.CheckResponse.$Shape|null;
  getMetadata?: languagecheck.MetadataResponse.$Shape|null;
  error?: languagecheck.ErrorResponse.$Shape|null;
  ok?: languagecheck.OkResponse.$Shape|null;
  $unknowns?: Uint8Array[];
} & (
  ({ payload?: undefined; checkProse?: null; getMetadata?: null; error?: null; ok?: null }|{ payload?: "checkProse"; checkProse: languagecheck.CheckResponse.$Shape; getMetadata?: null; error?: null; ok?: null }|{ payload?: "getMetadata"; checkProse?: null; getMetadata: languagecheck.MetadataResponse.$Shape; error?: null; ok?: null }|{ payload?: "error"; checkProse?: null; getMetadata?: null; error: languagecheck.ErrorResponse.$Shape; ok?: null }|{ payload?: "ok"; checkProse?: null; getMetadata?: null; error?: null; ok: languagecheck.OkResponse.$Shape })
);
    }

    /**
     * Properties of an OkResponse.
     * @deprecated Use languagecheck.OkResponse.$Properties instead.
     */
    interface IOkResponse extends languagecheck.OkResponse.$Properties {
    }

    /** Represents an OkResponse. */
    class OkResponse {

        /**
         * Constructs a new OkResponse.
         * @param [properties] Properties to set
         */
        constructor(properties?: languagecheck.OkResponse.$Properties);

        /** Unknown fields preserved while decoding */
        $unknowns?: Uint8Array[];

        /**
         * Creates a new OkResponse instance using the specified properties.
         * @param [properties] Properties to set
         * @returns OkResponse instance
         */
        static create(properties: languagecheck.OkResponse.$Shape): languagecheck.OkResponse & languagecheck.OkResponse.$Shape;
        static create(properties?: languagecheck.OkResponse.$Properties): languagecheck.OkResponse;

        /**
         * Encodes the specified OkResponse message. Does not implicitly {@link languagecheck.OkResponse.verify|verify} messages.
         * @param message OkResponse message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: languagecheck.OkResponse.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified OkResponse message, length delimited. Does not implicitly {@link languagecheck.OkResponse.verify|verify} messages.
         * @param message OkResponse message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encodeDelimited(message: languagecheck.OkResponse.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an OkResponse message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {languagecheck.OkResponse & languagecheck.OkResponse.$Shape} OkResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): languagecheck.OkResponse & languagecheck.OkResponse.$Shape;

        /**
         * Decodes an OkResponse message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns {languagecheck.OkResponse & languagecheck.OkResponse.$Shape} OkResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): languagecheck.OkResponse & languagecheck.OkResponse.$Shape;

        /**
         * Verifies an OkResponse message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an OkResponse message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns OkResponse
         */
        static fromObject(object: { [k: string]: any }): languagecheck.OkResponse;

        /**
         * Creates a plain object from an OkResponse message. Also converts values to other types if specified.
         * @param message OkResponse
         * @param [options] Conversion options
         * @returns Plain object
         */
        static toObject(message: languagecheck.OkResponse, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this OkResponse to JSON.
         * @returns JSON object
         */
        toJSON(): { [k: string]: any };

        /**
         * Gets the type url for OkResponse
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace OkResponse {

        /** Properties of an OkResponse. */
        interface $Properties {

            /** Unknown fields preserved while decoding */
            $unknowns?: Uint8Array[];
        }

        /** Shape of an OkResponse. */
        type $Shape = languagecheck.OkResponse.$Properties;
    }

    /**
     * Properties of an ErrorResponse.
     * @deprecated Use languagecheck.ErrorResponse.$Properties instead.
     */
    interface IErrorResponse extends languagecheck.ErrorResponse.$Properties {
    }

    /** Represents an ErrorResponse. */
    class ErrorResponse {

        /**
         * Constructs a new ErrorResponse.
         * @param [properties] Properties to set
         */
        constructor(properties?: languagecheck.ErrorResponse.$Properties);

        /** Unknown fields preserved while decoding */
        $unknowns?: Uint8Array[];

        /** ErrorResponse message. */
        message: string;

        /**
         * Creates a new ErrorResponse instance using the specified properties.
         * @param [properties] Properties to set
         * @returns ErrorResponse instance
         */
        static create(properties: languagecheck.ErrorResponse.$Shape): languagecheck.ErrorResponse & languagecheck.ErrorResponse.$Shape;
        static create(properties?: languagecheck.ErrorResponse.$Properties): languagecheck.ErrorResponse;

        /**
         * Encodes the specified ErrorResponse message. Does not implicitly {@link languagecheck.ErrorResponse.verify|verify} messages.
         * @param message ErrorResponse message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: languagecheck.ErrorResponse.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified ErrorResponse message, length delimited. Does not implicitly {@link languagecheck.ErrorResponse.verify|verify} messages.
         * @param message ErrorResponse message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encodeDelimited(message: languagecheck.ErrorResponse.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an ErrorResponse message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {languagecheck.ErrorResponse & languagecheck.ErrorResponse.$Shape} ErrorResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): languagecheck.ErrorResponse & languagecheck.ErrorResponse.$Shape;

        /**
         * Decodes an ErrorResponse message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns {languagecheck.ErrorResponse & languagecheck.ErrorResponse.$Shape} ErrorResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): languagecheck.ErrorResponse & languagecheck.ErrorResponse.$Shape;

        /**
         * Verifies an ErrorResponse message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an ErrorResponse message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns ErrorResponse
         */
        static fromObject(object: { [k: string]: any }): languagecheck.ErrorResponse;

        /**
         * Creates a plain object from an ErrorResponse message. Also converts values to other types if specified.
         * @param message ErrorResponse
         * @param [options] Conversion options
         * @returns Plain object
         */
        static toObject(message: languagecheck.ErrorResponse, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this ErrorResponse to JSON.
         * @returns JSON object
         */
        toJSON(): { [k: string]: any };

        /**
         * Gets the type url for ErrorResponse
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace ErrorResponse {

        /** Properties of an ErrorResponse. */
        interface $Properties {

            /** ErrorResponse message */
            message?: (string|null);

            /** Unknown fields preserved while decoding */
            $unknowns?: Uint8Array[];
        }

        /** Shape of an ErrorResponse. */
        type $Shape = languagecheck.ErrorResponse.$Properties;
    }

    /** Represents a CheckerProvider */
    class CheckerProvider extends $protobuf.rpc.Service {

        /**
         * Constructs a new CheckerProvider service.
         * @param rpcImpl RPC implementation
         * @param [requestDelimited=false] Whether requests are length-delimited
         * @param [responseDelimited=false] Whether responses are length-delimited
         */
        constructor(rpcImpl: $protobuf.RPCImpl, requestDelimited?: boolean, responseDelimited?: boolean);

        /**
         * Creates new CheckerProvider service using the specified rpc implementation.
         * @param rpcImpl RPC implementation
         * @param [requestDelimited=false] Whether requests are length-delimited
         * @param [responseDelimited=false] Whether responses are length-delimited
         * @returns RPC service. Useful where requests and/or responses are streamed.
         */
        static create(rpcImpl: $protobuf.RPCImpl, requestDelimited?: boolean, responseDelimited?: boolean): CheckerProvider;

        /**
         * Calls CheckProse.
         * @param request CheckRequest message or plain object
         * @param callback Node-style callback called with the error, if any, and CheckResponse
         */
        checkProse(request: languagecheck.ICheckRequest, callback: languagecheck.CheckerProvider.CheckProseCallback): void;

        /**
         * Calls CheckProse.
         * @param request CheckRequest message or plain object
         * @returns Promise
         */
        checkProse(request: languagecheck.ICheckRequest): Promise<languagecheck.CheckResponse>;

        /**
         * Calls GetMetadata.
         * @param request MetadataRequest message or plain object
         * @param callback Node-style callback called with the error, if any, and MetadataResponse
         */
        getMetadata(request: languagecheck.IMetadataRequest, callback: languagecheck.CheckerProvider.GetMetadataCallback): void;

        /**
         * Calls GetMetadata.
         * @param request MetadataRequest message or plain object
         * @returns Promise
         */
        getMetadata(request: languagecheck.IMetadataRequest): Promise<languagecheck.MetadataResponse>;
    }

    namespace CheckerProvider {

        /**
         * Callback as used by {@link languagecheck.CheckerProvider#checkProse}.
         * @param error Error, if any
         * @param [response] CheckResponse
         */
        type CheckProseCallback = (error: (Error|null), response?: languagecheck.CheckResponse) => void;

        /**
         * Callback as used by {@link languagecheck.CheckerProvider#getMetadata}.
         * @param error Error, if any
         * @param [response] MetadataResponse
         */
        type GetMetadataCallback = (error: (Error|null), response?: languagecheck.MetadataResponse) => void;
    }

    /**
     * Properties of a CheckRequest.
     * @deprecated Use languagecheck.CheckRequest.$Properties instead.
     */
    interface ICheckRequest extends languagecheck.CheckRequest.$Properties {
    }

    /** Represents a CheckRequest. */
    class CheckRequest {

        /**
         * Constructs a new CheckRequest.
         * @param [properties] Properties to set
         */
        constructor(properties?: languagecheck.CheckRequest.$Properties);

        /** Unknown fields preserved while decoding */
        $unknowns?: Uint8Array[];

        /** CheckRequest text. */
        text: string;

        /** CheckRequest languageId. */
        languageId: string;

        /** CheckRequest settings. */
        settings: { [k: string]: string };

        /** CheckRequest filePath. */
        filePath?: (string|null);

        /**
         * Creates a new CheckRequest instance using the specified properties.
         * @param [properties] Properties to set
         * @returns CheckRequest instance
         */
        static create(properties: languagecheck.CheckRequest.$Shape): languagecheck.CheckRequest & languagecheck.CheckRequest.$Shape;
        static create(properties?: languagecheck.CheckRequest.$Properties): languagecheck.CheckRequest;

        /**
         * Encodes the specified CheckRequest message. Does not implicitly {@link languagecheck.CheckRequest.verify|verify} messages.
         * @param message CheckRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: languagecheck.CheckRequest.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified CheckRequest message, length delimited. Does not implicitly {@link languagecheck.CheckRequest.verify|verify} messages.
         * @param message CheckRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encodeDelimited(message: languagecheck.CheckRequest.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a CheckRequest message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {languagecheck.CheckRequest & languagecheck.CheckRequest.$Shape} CheckRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): languagecheck.CheckRequest & languagecheck.CheckRequest.$Shape;

        /**
         * Decodes a CheckRequest message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns {languagecheck.CheckRequest & languagecheck.CheckRequest.$Shape} CheckRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): languagecheck.CheckRequest & languagecheck.CheckRequest.$Shape;

        /**
         * Verifies a CheckRequest message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a CheckRequest message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns CheckRequest
         */
        static fromObject(object: { [k: string]: any }): languagecheck.CheckRequest;

        /**
         * Creates a plain object from a CheckRequest message. Also converts values to other types if specified.
         * @param message CheckRequest
         * @param [options] Conversion options
         * @returns Plain object
         */
        static toObject(message: languagecheck.CheckRequest, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this CheckRequest to JSON.
         * @returns JSON object
         */
        toJSON(): { [k: string]: any };

        /**
         * Gets the type url for CheckRequest
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace CheckRequest {

        /** Properties of a CheckRequest. */
        interface $Properties {

            /** CheckRequest text */
            text?: (string|null);

            /** CheckRequest languageId */
            languageId?: (string|null);

            /** CheckRequest settings */
            settings?: ({ [k: string]: string }|null);

            /** CheckRequest filePath */
            filePath?: (string|null);

            /** Unknown fields preserved while decoding */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a CheckRequest. */
        type $Shape = languagecheck.CheckRequest.$Properties;
    }

    /**
     * Properties of a CheckResponse.
     * @deprecated Use languagecheck.CheckResponse.$Properties instead.
     */
    interface ICheckResponse extends languagecheck.CheckResponse.$Properties {
    }

    /** Represents a CheckResponse. */
    class CheckResponse {

        /**
         * Constructs a new CheckResponse.
         * @param [properties] Properties to set
         */
        constructor(properties?: languagecheck.CheckResponse.$Properties);

        /** Unknown fields preserved while decoding */
        $unknowns?: Uint8Array[];

        /** CheckResponse diagnostics. */
        diagnostics: languagecheck.Diagnostic.$Properties[];

        /** CheckResponse extraction. */
        extraction?: (languagecheck.ExtractionInfo.$Properties|null);

        /** CheckResponse engineHealth. */
        engineHealth: languagecheck.EngineHealth.$Properties[];

        /**
         * Creates a new CheckResponse instance using the specified properties.
         * @param [properties] Properties to set
         * @returns CheckResponse instance
         */
        static create(properties: languagecheck.CheckResponse.$Shape): languagecheck.CheckResponse & languagecheck.CheckResponse.$Shape;
        static create(properties?: languagecheck.CheckResponse.$Properties): languagecheck.CheckResponse;

        /**
         * Encodes the specified CheckResponse message. Does not implicitly {@link languagecheck.CheckResponse.verify|verify} messages.
         * @param message CheckResponse message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: languagecheck.CheckResponse.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified CheckResponse message, length delimited. Does not implicitly {@link languagecheck.CheckResponse.verify|verify} messages.
         * @param message CheckResponse message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encodeDelimited(message: languagecheck.CheckResponse.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a CheckResponse message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {languagecheck.CheckResponse & languagecheck.CheckResponse.$Shape} CheckResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): languagecheck.CheckResponse & languagecheck.CheckResponse.$Shape;

        /**
         * Decodes a CheckResponse message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns {languagecheck.CheckResponse & languagecheck.CheckResponse.$Shape} CheckResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): languagecheck.CheckResponse & languagecheck.CheckResponse.$Shape;

        /**
         * Verifies a CheckResponse message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a CheckResponse message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns CheckResponse
         */
        static fromObject(object: { [k: string]: any }): languagecheck.CheckResponse;

        /**
         * Creates a plain object from a CheckResponse message. Also converts values to other types if specified.
         * @param message CheckResponse
         * @param [options] Conversion options
         * @returns Plain object
         */
        static toObject(message: languagecheck.CheckResponse, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this CheckResponse to JSON.
         * @returns JSON object
         */
        toJSON(): { [k: string]: any };

        /**
         * Gets the type url for CheckResponse
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace CheckResponse {

        /** Properties of a CheckResponse. */
        interface $Properties {

            /** CheckResponse diagnostics */
            diagnostics?: (languagecheck.Diagnostic.$Properties[]|null);

            /** CheckResponse extraction */
            extraction?: (languagecheck.ExtractionInfo.$Properties|null);

            /** CheckResponse engineHealth */
            engineHealth?: (languagecheck.EngineHealth.$Properties[]|null);

            /** Unknown fields preserved while decoding */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a CheckResponse. */
        type $Shape = languagecheck.CheckResponse.$Properties;
    }

    /**
     * Properties of an EngineHealth.
     * @deprecated Use languagecheck.EngineHealth.$Properties instead.
     */
    interface IEngineHealth extends languagecheck.EngineHealth.$Properties {
    }

    /** Represents an EngineHealth. */
    class EngineHealth {

        /**
         * Constructs a new EngineHealth.
         * @param [properties] Properties to set
         */
        constructor(properties?: languagecheck.EngineHealth.$Properties);

        /** Unknown fields preserved while decoding */
        $unknowns?: Uint8Array[];

        /** EngineHealth name. */
        name: string;

        /** EngineHealth status. */
        status: string;

        /** EngineHealth consecutiveFailures. */
        consecutiveFailures: number;

        /** EngineHealth lastError. */
        lastError: string;

        /** EngineHealth lastSuccessEpochMs. */
        lastSuccessEpochMs: (number|Long);

        /**
         * Creates a new EngineHealth instance using the specified properties.
         * @param [properties] Properties to set
         * @returns EngineHealth instance
         */
        static create(properties: languagecheck.EngineHealth.$Shape): languagecheck.EngineHealth & languagecheck.EngineHealth.$Shape;
        static create(properties?: languagecheck.EngineHealth.$Properties): languagecheck.EngineHealth;

        /**
         * Encodes the specified EngineHealth message. Does not implicitly {@link languagecheck.EngineHealth.verify|verify} messages.
         * @param message EngineHealth message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: languagecheck.EngineHealth.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified EngineHealth message, length delimited. Does not implicitly {@link languagecheck.EngineHealth.verify|verify} messages.
         * @param message EngineHealth message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encodeDelimited(message: languagecheck.EngineHealth.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an EngineHealth message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {languagecheck.EngineHealth & languagecheck.EngineHealth.$Shape} EngineHealth
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): languagecheck.EngineHealth & languagecheck.EngineHealth.$Shape;

        /**
         * Decodes an EngineHealth message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns {languagecheck.EngineHealth & languagecheck.EngineHealth.$Shape} EngineHealth
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): languagecheck.EngineHealth & languagecheck.EngineHealth.$Shape;

        /**
         * Verifies an EngineHealth message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an EngineHealth message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns EngineHealth
         */
        static fromObject(object: { [k: string]: any }): languagecheck.EngineHealth;

        /**
         * Creates a plain object from an EngineHealth message. Also converts values to other types if specified.
         * @param message EngineHealth
         * @param [options] Conversion options
         * @returns Plain object
         */
        static toObject(message: languagecheck.EngineHealth, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this EngineHealth to JSON.
         * @returns JSON object
         */
        toJSON(): { [k: string]: any };

        /**
         * Gets the type url for EngineHealth
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace EngineHealth {

        /** Properties of an EngineHealth. */
        interface $Properties {

            /** EngineHealth name */
            name?: (string|null);

            /** EngineHealth status */
            status?: (string|null);

            /** EngineHealth consecutiveFailures */
            consecutiveFailures?: (number|null);

            /** EngineHealth lastError */
            lastError?: (string|null);

            /** EngineHealth lastSuccessEpochMs */
            lastSuccessEpochMs?: (number|Long|null);

            /** Unknown fields preserved while decoding */
            $unknowns?: Uint8Array[];
        }

        /** Shape of an EngineHealth. */
        type $Shape = languagecheck.EngineHealth.$Properties;
    }

    /**
     * Properties of an ExtractionExclusion.
     * @deprecated Use languagecheck.ExtractionExclusion.$Properties instead.
     */
    interface IExtractionExclusion extends languagecheck.ExtractionExclusion.$Properties {
    }

    /** Represents an ExtractionExclusion. */
    class ExtractionExclusion {

        /**
         * Constructs a new ExtractionExclusion.
         * @param [properties] Properties to set
         */
        constructor(properties?: languagecheck.ExtractionExclusion.$Properties);

        /** Unknown fields preserved while decoding */
        $unknowns?: Uint8Array[];

        /** ExtractionExclusion startByte. */
        startByte: number;

        /** ExtractionExclusion endByte. */
        endByte: number;

        /**
         * Creates a new ExtractionExclusion instance using the specified properties.
         * @param [properties] Properties to set
         * @returns ExtractionExclusion instance
         */
        static create(properties: languagecheck.ExtractionExclusion.$Shape): languagecheck.ExtractionExclusion & languagecheck.ExtractionExclusion.$Shape;
        static create(properties?: languagecheck.ExtractionExclusion.$Properties): languagecheck.ExtractionExclusion;

        /**
         * Encodes the specified ExtractionExclusion message. Does not implicitly {@link languagecheck.ExtractionExclusion.verify|verify} messages.
         * @param message ExtractionExclusion message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: languagecheck.ExtractionExclusion.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified ExtractionExclusion message, length delimited. Does not implicitly {@link languagecheck.ExtractionExclusion.verify|verify} messages.
         * @param message ExtractionExclusion message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encodeDelimited(message: languagecheck.ExtractionExclusion.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an ExtractionExclusion message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {languagecheck.ExtractionExclusion & languagecheck.ExtractionExclusion.$Shape} ExtractionExclusion
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): languagecheck.ExtractionExclusion & languagecheck.ExtractionExclusion.$Shape;

        /**
         * Decodes an ExtractionExclusion message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns {languagecheck.ExtractionExclusion & languagecheck.ExtractionExclusion.$Shape} ExtractionExclusion
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): languagecheck.ExtractionExclusion & languagecheck.ExtractionExclusion.$Shape;

        /**
         * Verifies an ExtractionExclusion message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an ExtractionExclusion message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns ExtractionExclusion
         */
        static fromObject(object: { [k: string]: any }): languagecheck.ExtractionExclusion;

        /**
         * Creates a plain object from an ExtractionExclusion message. Also converts values to other types if specified.
         * @param message ExtractionExclusion
         * @param [options] Conversion options
         * @returns Plain object
         */
        static toObject(message: languagecheck.ExtractionExclusion, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this ExtractionExclusion to JSON.
         * @returns JSON object
         */
        toJSON(): { [k: string]: any };

        /**
         * Gets the type url for ExtractionExclusion
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace ExtractionExclusion {

        /** Properties of an ExtractionExclusion. */
        interface $Properties {

            /** ExtractionExclusion startByte */
            startByte?: (number|null);

            /** ExtractionExclusion endByte */
            endByte?: (number|null);

            /** Unknown fields preserved while decoding */
            $unknowns?: Uint8Array[];
        }

        /** Shape of an ExtractionExclusion. */
        type $Shape = languagecheck.ExtractionExclusion.$Properties;
    }

    /**
     * Properties of an ExtractionProseRange.
     * @deprecated Use languagecheck.ExtractionProseRange.$Properties instead.
     */
    interface IExtractionProseRange extends languagecheck.ExtractionProseRange.$Properties {
    }

    /** Represents an ExtractionProseRange. */
    class ExtractionProseRange {

        /**
         * Constructs a new ExtractionProseRange.
         * @param [properties] Properties to set
         */
        constructor(properties?: languagecheck.ExtractionProseRange.$Properties);

        /** Unknown fields preserved while decoding */
        $unknowns?: Uint8Array[];

        /** ExtractionProseRange startByte. */
        startByte: number;

        /** ExtractionProseRange endByte. */
        endByte: number;

        /** ExtractionProseRange exclusions. */
        exclusions: languagecheck.ExtractionExclusion.$Properties[];

        /**
         * Creates a new ExtractionProseRange instance using the specified properties.
         * @param [properties] Properties to set
         * @returns ExtractionProseRange instance
         */
        static create(properties: languagecheck.ExtractionProseRange.$Shape): languagecheck.ExtractionProseRange & languagecheck.ExtractionProseRange.$Shape;
        static create(properties?: languagecheck.ExtractionProseRange.$Properties): languagecheck.ExtractionProseRange;

        /**
         * Encodes the specified ExtractionProseRange message. Does not implicitly {@link languagecheck.ExtractionProseRange.verify|verify} messages.
         * @param message ExtractionProseRange message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: languagecheck.ExtractionProseRange.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified ExtractionProseRange message, length delimited. Does not implicitly {@link languagecheck.ExtractionProseRange.verify|verify} messages.
         * @param message ExtractionProseRange message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encodeDelimited(message: languagecheck.ExtractionProseRange.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an ExtractionProseRange message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {languagecheck.ExtractionProseRange & languagecheck.ExtractionProseRange.$Shape} ExtractionProseRange
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): languagecheck.ExtractionProseRange & languagecheck.ExtractionProseRange.$Shape;

        /**
         * Decodes an ExtractionProseRange message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns {languagecheck.ExtractionProseRange & languagecheck.ExtractionProseRange.$Shape} ExtractionProseRange
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): languagecheck.ExtractionProseRange & languagecheck.ExtractionProseRange.$Shape;

        /**
         * Verifies an ExtractionProseRange message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an ExtractionProseRange message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns ExtractionProseRange
         */
        static fromObject(object: { [k: string]: any }): languagecheck.ExtractionProseRange;

        /**
         * Creates a plain object from an ExtractionProseRange message. Also converts values to other types if specified.
         * @param message ExtractionProseRange
         * @param [options] Conversion options
         * @returns Plain object
         */
        static toObject(message: languagecheck.ExtractionProseRange, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this ExtractionProseRange to JSON.
         * @returns JSON object
         */
        toJSON(): { [k: string]: any };

        /**
         * Gets the type url for ExtractionProseRange
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace ExtractionProseRange {

        /** Properties of an ExtractionProseRange. */
        interface $Properties {

            /** ExtractionProseRange startByte */
            startByte?: (number|null);

            /** ExtractionProseRange endByte */
            endByte?: (number|null);

            /** ExtractionProseRange exclusions */
            exclusions?: (languagecheck.ExtractionExclusion.$Properties[]|null);

            /** Unknown fields preserved while decoding */
            $unknowns?: Uint8Array[];
        }

        /** Shape of an ExtractionProseRange. */
        type $Shape = languagecheck.ExtractionProseRange.$Properties;
    }

    /**
     * Properties of an ExtractionInfo.
     * @deprecated Use languagecheck.ExtractionInfo.$Properties instead.
     */
    interface IExtractionInfo extends languagecheck.ExtractionInfo.$Properties {
    }

    /** Represents an ExtractionInfo. */
    class ExtractionInfo {

        /**
         * Constructs a new ExtractionInfo.
         * @param [properties] Properties to set
         */
        constructor(properties?: languagecheck.ExtractionInfo.$Properties);

        /** Unknown fields preserved while decoding */
        $unknowns?: Uint8Array[];

        /** ExtractionInfo proseRanges. */
        proseRanges: languagecheck.ExtractionProseRange.$Properties[];

        /**
         * Creates a new ExtractionInfo instance using the specified properties.
         * @param [properties] Properties to set
         * @returns ExtractionInfo instance
         */
        static create(properties: languagecheck.ExtractionInfo.$Shape): languagecheck.ExtractionInfo & languagecheck.ExtractionInfo.$Shape;
        static create(properties?: languagecheck.ExtractionInfo.$Properties): languagecheck.ExtractionInfo;

        /**
         * Encodes the specified ExtractionInfo message. Does not implicitly {@link languagecheck.ExtractionInfo.verify|verify} messages.
         * @param message ExtractionInfo message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: languagecheck.ExtractionInfo.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified ExtractionInfo message, length delimited. Does not implicitly {@link languagecheck.ExtractionInfo.verify|verify} messages.
         * @param message ExtractionInfo message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encodeDelimited(message: languagecheck.ExtractionInfo.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an ExtractionInfo message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {languagecheck.ExtractionInfo & languagecheck.ExtractionInfo.$Shape} ExtractionInfo
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): languagecheck.ExtractionInfo & languagecheck.ExtractionInfo.$Shape;

        /**
         * Decodes an ExtractionInfo message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns {languagecheck.ExtractionInfo & languagecheck.ExtractionInfo.$Shape} ExtractionInfo
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): languagecheck.ExtractionInfo & languagecheck.ExtractionInfo.$Shape;

        /**
         * Verifies an ExtractionInfo message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an ExtractionInfo message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns ExtractionInfo
         */
        static fromObject(object: { [k: string]: any }): languagecheck.ExtractionInfo;

        /**
         * Creates a plain object from an ExtractionInfo message. Also converts values to other types if specified.
         * @param message ExtractionInfo
         * @param [options] Conversion options
         * @returns Plain object
         */
        static toObject(message: languagecheck.ExtractionInfo, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this ExtractionInfo to JSON.
         * @returns JSON object
         */
        toJSON(): { [k: string]: any };

        /**
         * Gets the type url for ExtractionInfo
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace ExtractionInfo {

        /** Properties of an ExtractionInfo. */
        interface $Properties {

            /** ExtractionInfo proseRanges */
            proseRanges?: (languagecheck.ExtractionProseRange.$Properties[]|null);

            /** Unknown fields preserved while decoding */
            $unknowns?: Uint8Array[];
        }

        /** Shape of an ExtractionInfo. */
        type $Shape = languagecheck.ExtractionInfo.$Properties;
    }

    /**
     * Properties of a Diagnostic.
     * @deprecated Use languagecheck.Diagnostic.$Properties instead.
     */
    interface IDiagnostic extends languagecheck.Diagnostic.$Properties {
    }

    /** Represents a Diagnostic. */
    class Diagnostic {

        /**
         * Constructs a new Diagnostic.
         * @param [properties] Properties to set
         */
        constructor(properties?: languagecheck.Diagnostic.$Properties);

        /** Unknown fields preserved while decoding */
        $unknowns?: Uint8Array[];

        /** Diagnostic startByte. */
        startByte: number;

        /** Diagnostic endByte. */
        endByte: number;

        /** Diagnostic message. */
        message: string;

        /** Diagnostic suggestions. */
        suggestions: string[];

        /** Diagnostic ruleId. */
        ruleId: string;

        /** Diagnostic severity. */
        severity: languagecheck.Severity;

        /** Diagnostic unifiedId. */
        unifiedId: string;

        /** Diagnostic confidence. */
        confidence: number;

        /**
         * Creates a new Diagnostic instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Diagnostic instance
         */
        static create(properties: languagecheck.Diagnostic.$Shape): languagecheck.Diagnostic & languagecheck.Diagnostic.$Shape;
        static create(properties?: languagecheck.Diagnostic.$Properties): languagecheck.Diagnostic;

        /**
         * Encodes the specified Diagnostic message. Does not implicitly {@link languagecheck.Diagnostic.verify|verify} messages.
         * @param message Diagnostic message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: languagecheck.Diagnostic.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Diagnostic message, length delimited. Does not implicitly {@link languagecheck.Diagnostic.verify|verify} messages.
         * @param message Diagnostic message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encodeDelimited(message: languagecheck.Diagnostic.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Diagnostic message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {languagecheck.Diagnostic & languagecheck.Diagnostic.$Shape} Diagnostic
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): languagecheck.Diagnostic & languagecheck.Diagnostic.$Shape;

        /**
         * Decodes a Diagnostic message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns {languagecheck.Diagnostic & languagecheck.Diagnostic.$Shape} Diagnostic
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): languagecheck.Diagnostic & languagecheck.Diagnostic.$Shape;

        /**
         * Verifies a Diagnostic message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a Diagnostic message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Diagnostic
         */
        static fromObject(object: { [k: string]: any }): languagecheck.Diagnostic;

        /**
         * Creates a plain object from a Diagnostic message. Also converts values to other types if specified.
         * @param message Diagnostic
         * @param [options] Conversion options
         * @returns Plain object
         */
        static toObject(message: languagecheck.Diagnostic, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Diagnostic to JSON.
         * @returns JSON object
         */
        toJSON(): { [k: string]: any };

        /**
         * Gets the type url for Diagnostic
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace Diagnostic {

        /** Properties of a Diagnostic. */
        interface $Properties {

            /** Diagnostic startByte */
            startByte?: (number|null);

            /** Diagnostic endByte */
            endByte?: (number|null);

            /** Diagnostic message */
            message?: (string|null);

            /** Diagnostic suggestions */
            suggestions?: (string[]|null);

            /** Diagnostic ruleId */
            ruleId?: (string|null);

            /** Diagnostic severity */
            severity?: (languagecheck.Severity|null);

            /** Diagnostic unifiedId */
            unifiedId?: (string|null);

            /** Diagnostic confidence */
            confidence?: (number|null);

            /** Unknown fields preserved while decoding */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a Diagnostic. */
        type $Shape = languagecheck.Diagnostic.$Properties;
    }

    /** Severity enum. */
    enum Severity {

        /** SEVERITY_UNSPECIFIED value */
        SEVERITY_UNSPECIFIED = 0,

        /** SEVERITY_INFORMATION value */
        SEVERITY_INFORMATION = 1,

        /** SEVERITY_WARNING value */
        SEVERITY_WARNING = 2,

        /** SEVERITY_ERROR value */
        SEVERITY_ERROR = 3,

        /** SEVERITY_HINT value */
        SEVERITY_HINT = 4
    }

    /**
     * Properties of an AddDictionaryWordRequest.
     * @deprecated Use languagecheck.AddDictionaryWordRequest.$Properties instead.
     */
    interface IAddDictionaryWordRequest extends languagecheck.AddDictionaryWordRequest.$Properties {
    }

    /** Represents an AddDictionaryWordRequest. */
    class AddDictionaryWordRequest {

        /**
         * Constructs a new AddDictionaryWordRequest.
         * @param [properties] Properties to set
         */
        constructor(properties?: languagecheck.AddDictionaryWordRequest.$Properties);

        /** Unknown fields preserved while decoding */
        $unknowns?: Uint8Array[];

        /** AddDictionaryWordRequest word. */
        word: string;

        /**
         * Creates a new AddDictionaryWordRequest instance using the specified properties.
         * @param [properties] Properties to set
         * @returns AddDictionaryWordRequest instance
         */
        static create(properties: languagecheck.AddDictionaryWordRequest.$Shape): languagecheck.AddDictionaryWordRequest & languagecheck.AddDictionaryWordRequest.$Shape;
        static create(properties?: languagecheck.AddDictionaryWordRequest.$Properties): languagecheck.AddDictionaryWordRequest;

        /**
         * Encodes the specified AddDictionaryWordRequest message. Does not implicitly {@link languagecheck.AddDictionaryWordRequest.verify|verify} messages.
         * @param message AddDictionaryWordRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: languagecheck.AddDictionaryWordRequest.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified AddDictionaryWordRequest message, length delimited. Does not implicitly {@link languagecheck.AddDictionaryWordRequest.verify|verify} messages.
         * @param message AddDictionaryWordRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encodeDelimited(message: languagecheck.AddDictionaryWordRequest.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an AddDictionaryWordRequest message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {languagecheck.AddDictionaryWordRequest & languagecheck.AddDictionaryWordRequest.$Shape} AddDictionaryWordRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): languagecheck.AddDictionaryWordRequest & languagecheck.AddDictionaryWordRequest.$Shape;

        /**
         * Decodes an AddDictionaryWordRequest message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns {languagecheck.AddDictionaryWordRequest & languagecheck.AddDictionaryWordRequest.$Shape} AddDictionaryWordRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): languagecheck.AddDictionaryWordRequest & languagecheck.AddDictionaryWordRequest.$Shape;

        /**
         * Verifies an AddDictionaryWordRequest message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an AddDictionaryWordRequest message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns AddDictionaryWordRequest
         */
        static fromObject(object: { [k: string]: any }): languagecheck.AddDictionaryWordRequest;

        /**
         * Creates a plain object from an AddDictionaryWordRequest message. Also converts values to other types if specified.
         * @param message AddDictionaryWordRequest
         * @param [options] Conversion options
         * @returns Plain object
         */
        static toObject(message: languagecheck.AddDictionaryWordRequest, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this AddDictionaryWordRequest to JSON.
         * @returns JSON object
         */
        toJSON(): { [k: string]: any };

        /**
         * Gets the type url for AddDictionaryWordRequest
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace AddDictionaryWordRequest {

        /** Properties of an AddDictionaryWordRequest. */
        interface $Properties {

            /** AddDictionaryWordRequest word */
            word?: (string|null);

            /** Unknown fields preserved while decoding */
            $unknowns?: Uint8Array[];
        }

        /** Shape of an AddDictionaryWordRequest. */
        type $Shape = languagecheck.AddDictionaryWordRequest.$Properties;
    }

    /**
     * Properties of a MetadataRequest.
     * @deprecated Use languagecheck.MetadataRequest.$Properties instead.
     */
    interface IMetadataRequest extends languagecheck.MetadataRequest.$Properties {
    }

    /** Represents a MetadataRequest. */
    class MetadataRequest {

        /**
         * Constructs a new MetadataRequest.
         * @param [properties] Properties to set
         */
        constructor(properties?: languagecheck.MetadataRequest.$Properties);

        /** Unknown fields preserved while decoding */
        $unknowns?: Uint8Array[];

        /**
         * Creates a new MetadataRequest instance using the specified properties.
         * @param [properties] Properties to set
         * @returns MetadataRequest instance
         */
        static create(properties: languagecheck.MetadataRequest.$Shape): languagecheck.MetadataRequest & languagecheck.MetadataRequest.$Shape;
        static create(properties?: languagecheck.MetadataRequest.$Properties): languagecheck.MetadataRequest;

        /**
         * Encodes the specified MetadataRequest message. Does not implicitly {@link languagecheck.MetadataRequest.verify|verify} messages.
         * @param message MetadataRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: languagecheck.MetadataRequest.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified MetadataRequest message, length delimited. Does not implicitly {@link languagecheck.MetadataRequest.verify|verify} messages.
         * @param message MetadataRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encodeDelimited(message: languagecheck.MetadataRequest.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a MetadataRequest message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {languagecheck.MetadataRequest & languagecheck.MetadataRequest.$Shape} MetadataRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): languagecheck.MetadataRequest & languagecheck.MetadataRequest.$Shape;

        /**
         * Decodes a MetadataRequest message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns {languagecheck.MetadataRequest & languagecheck.MetadataRequest.$Shape} MetadataRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): languagecheck.MetadataRequest & languagecheck.MetadataRequest.$Shape;

        /**
         * Verifies a MetadataRequest message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a MetadataRequest message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns MetadataRequest
         */
        static fromObject(object: { [k: string]: any }): languagecheck.MetadataRequest;

        /**
         * Creates a plain object from a MetadataRequest message. Also converts values to other types if specified.
         * @param message MetadataRequest
         * @param [options] Conversion options
         * @returns Plain object
         */
        static toObject(message: languagecheck.MetadataRequest, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this MetadataRequest to JSON.
         * @returns JSON object
         */
        toJSON(): { [k: string]: any };

        /**
         * Gets the type url for MetadataRequest
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace MetadataRequest {

        /** Properties of a MetadataRequest. */
        interface $Properties {

            /** Unknown fields preserved while decoding */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a MetadataRequest. */
        type $Shape = languagecheck.MetadataRequest.$Properties;
    }

    /**
     * Properties of a MetadataResponse.
     * @deprecated Use languagecheck.MetadataResponse.$Properties instead.
     */
    interface IMetadataResponse extends languagecheck.MetadataResponse.$Properties {
    }

    /** Represents a MetadataResponse. */
    class MetadataResponse {

        /**
         * Constructs a new MetadataResponse.
         * @param [properties] Properties to set
         */
        constructor(properties?: languagecheck.MetadataResponse.$Properties);

        /** Unknown fields preserved while decoding */
        $unknowns?: Uint8Array[];

        /** MetadataResponse name. */
        name: string;

        /** MetadataResponse version. */
        version: string;

        /** MetadataResponse supportedLanguages. */
        supportedLanguages: string[];

        /** MetadataResponse spellLanguage. */
        spellLanguage: string;

        /**
         * Creates a new MetadataResponse instance using the specified properties.
         * @param [properties] Properties to set
         * @returns MetadataResponse instance
         */
        static create(properties: languagecheck.MetadataResponse.$Shape): languagecheck.MetadataResponse & languagecheck.MetadataResponse.$Shape;
        static create(properties?: languagecheck.MetadataResponse.$Properties): languagecheck.MetadataResponse;

        /**
         * Encodes the specified MetadataResponse message. Does not implicitly {@link languagecheck.MetadataResponse.verify|verify} messages.
         * @param message MetadataResponse message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encode(message: languagecheck.MetadataResponse.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified MetadataResponse message, length delimited. Does not implicitly {@link languagecheck.MetadataResponse.verify|verify} messages.
         * @param message MetadataResponse message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        static encodeDelimited(message: languagecheck.MetadataResponse.$Properties, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a MetadataResponse message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns {languagecheck.MetadataResponse & languagecheck.MetadataResponse.$Shape} MetadataResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): languagecheck.MetadataResponse & languagecheck.MetadataResponse.$Shape;

        /**
         * Decodes a MetadataResponse message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns {languagecheck.MetadataResponse & languagecheck.MetadataResponse.$Shape} MetadataResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): languagecheck.MetadataResponse & languagecheck.MetadataResponse.$Shape;

        /**
         * Verifies a MetadataResponse message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a MetadataResponse message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns MetadataResponse
         */
        static fromObject(object: { [k: string]: any }): languagecheck.MetadataResponse;

        /**
         * Creates a plain object from a MetadataResponse message. Also converts values to other types if specified.
         * @param message MetadataResponse
         * @param [options] Conversion options
         * @returns Plain object
         */
        static toObject(message: languagecheck.MetadataResponse, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this MetadataResponse to JSON.
         * @returns JSON object
         */
        toJSON(): { [k: string]: any };

        /**
         * Gets the type url for MetadataResponse
         * @param [prefix] Custom type url prefix, defaults to `"type.googleapis.com"`
         * @returns The type url
         */
        static getTypeUrl(prefix?: string): string;
    }

    namespace MetadataResponse {

        /** Properties of a MetadataResponse. */
        interface $Properties {

            /** MetadataResponse name */
            name?: (string|null);

            /** MetadataResponse version */
            version?: (string|null);

            /** MetadataResponse supportedLanguages */
            supportedLanguages?: (string[]|null);

            /** MetadataResponse spellLanguage */
            spellLanguage?: (string|null);

            /** Unknown fields preserved while decoding */
            $unknowns?: Uint8Array[];
        }

        /** Shape of a MetadataResponse. */
        type $Shape = languagecheck.MetadataResponse.$Properties;
    }
}
