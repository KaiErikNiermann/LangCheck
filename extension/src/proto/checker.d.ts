import * as $protobuf from "protobufjs";
import Long = require("long");
/** Namespace languagecheck. */
export namespace languagecheck {

    /** Properties of a Request. */
    interface IRequest {

        /** Request id */
        id?: (number|Long|null);

        /** Request checkProse */
        checkProse?: (languagecheck.ICheckRequest|null);

        /** Request getMetadata */
        getMetadata?: (languagecheck.IMetadataRequest|null);

        /** Request ignore */
        ignore?: (languagecheck.IIgnoreRequest|null);

        /** Request initialize */
        initialize?: (languagecheck.IInitializeRequest|null);

        /** Request addDictionaryWord */
        addDictionaryWord?: (languagecheck.IAddDictionaryWordRequest|null);
    }

    /** Represents a Request. */
    class Request implements IRequest {

        /**
         * Constructs a new Request.
         * @param [properties] Properties to set
         */
        constructor(properties?: languagecheck.IRequest);

        /** Request id. */
        public id: (number|Long);

        /** Request checkProse. */
        public checkProse?: (languagecheck.ICheckRequest|null);

        /** Request getMetadata. */
        public getMetadata?: (languagecheck.IMetadataRequest|null);

        /** Request ignore. */
        public ignore?: (languagecheck.IIgnoreRequest|null);

        /** Request initialize. */
        public initialize?: (languagecheck.IInitializeRequest|null);

        /** Request addDictionaryWord. */
        public addDictionaryWord?: (languagecheck.IAddDictionaryWordRequest|null);

        /** Request payload. */
        public payload?: ("checkProse"|"getMetadata"|"ignore"|"initialize"|"addDictionaryWord");

        /**
         * Creates a new Request instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Request instance
         */
        public static create(properties?: languagecheck.IRequest): languagecheck.Request;

        /**
         * Encodes the specified Request message. Does not implicitly {@link languagecheck.Request.verify|verify} messages.
         * @param message Request message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: languagecheck.IRequest, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Request message, length delimited. Does not implicitly {@link languagecheck.Request.verify|verify} messages.
         * @param message Request message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: languagecheck.IRequest, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Request message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Request
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): languagecheck.Request;

        /**
         * Decodes a Request message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Request
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): languagecheck.Request;

        /**
         * Verifies a Request message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a Request message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Request
         */
        public static fromObject(object: { [k: string]: any }): languagecheck.Request;

        /**
         * Creates a plain object from a Request message. Also converts values to other types if specified.
         * @param message Request
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: languagecheck.Request, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Request to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for Request
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of an InitializeRequest. */
    interface IInitializeRequest {

        /** InitializeRequest workspaceRoot */
        workspaceRoot?: (string|null);

        /** InitializeRequest indexOnOpen */
        indexOnOpen?: (boolean|null);
    }

    /** Represents an InitializeRequest. */
    class InitializeRequest implements IInitializeRequest {

        /**
         * Constructs a new InitializeRequest.
         * @param [properties] Properties to set
         */
        constructor(properties?: languagecheck.IInitializeRequest);

        /** InitializeRequest workspaceRoot. */
        public workspaceRoot: string;

        /** InitializeRequest indexOnOpen. */
        public indexOnOpen?: (boolean|null);

        /**
         * Creates a new InitializeRequest instance using the specified properties.
         * @param [properties] Properties to set
         * @returns InitializeRequest instance
         */
        public static create(properties?: languagecheck.IInitializeRequest): languagecheck.InitializeRequest;

        /**
         * Encodes the specified InitializeRequest message. Does not implicitly {@link languagecheck.InitializeRequest.verify|verify} messages.
         * @param message InitializeRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: languagecheck.IInitializeRequest, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified InitializeRequest message, length delimited. Does not implicitly {@link languagecheck.InitializeRequest.verify|verify} messages.
         * @param message InitializeRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: languagecheck.IInitializeRequest, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an InitializeRequest message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns InitializeRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): languagecheck.InitializeRequest;

        /**
         * Decodes an InitializeRequest message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns InitializeRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): languagecheck.InitializeRequest;

        /**
         * Verifies an InitializeRequest message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an InitializeRequest message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns InitializeRequest
         */
        public static fromObject(object: { [k: string]: any }): languagecheck.InitializeRequest;

        /**
         * Creates a plain object from an InitializeRequest message. Also converts values to other types if specified.
         * @param message InitializeRequest
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: languagecheck.InitializeRequest, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this InitializeRequest to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for InitializeRequest
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of an IgnoreRequest. */
    interface IIgnoreRequest {

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
    }

    /** Represents an IgnoreRequest. */
    class IgnoreRequest implements IIgnoreRequest {

        /**
         * Constructs a new IgnoreRequest.
         * @param [properties] Properties to set
         */
        constructor(properties?: languagecheck.IIgnoreRequest);

        /** IgnoreRequest message. */
        public message: string;

        /** IgnoreRequest context. */
        public context: string;

        /** IgnoreRequest text. */
        public text: string;

        /** IgnoreRequest startByte. */
        public startByte: number;

        /** IgnoreRequest endByte. */
        public endByte: number;

        /**
         * Creates a new IgnoreRequest instance using the specified properties.
         * @param [properties] Properties to set
         * @returns IgnoreRequest instance
         */
        public static create(properties?: languagecheck.IIgnoreRequest): languagecheck.IgnoreRequest;

        /**
         * Encodes the specified IgnoreRequest message. Does not implicitly {@link languagecheck.IgnoreRequest.verify|verify} messages.
         * @param message IgnoreRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: languagecheck.IIgnoreRequest, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified IgnoreRequest message, length delimited. Does not implicitly {@link languagecheck.IgnoreRequest.verify|verify} messages.
         * @param message IgnoreRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: languagecheck.IIgnoreRequest, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an IgnoreRequest message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns IgnoreRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): languagecheck.IgnoreRequest;

        /**
         * Decodes an IgnoreRequest message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns IgnoreRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): languagecheck.IgnoreRequest;

        /**
         * Verifies an IgnoreRequest message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an IgnoreRequest message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns IgnoreRequest
         */
        public static fromObject(object: { [k: string]: any }): languagecheck.IgnoreRequest;

        /**
         * Creates a plain object from an IgnoreRequest message. Also converts values to other types if specified.
         * @param message IgnoreRequest
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: languagecheck.IgnoreRequest, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this IgnoreRequest to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for IgnoreRequest
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a Response. */
    interface IResponse {

        /** Response id */
        id?: (number|Long|null);

        /** Response checkProse */
        checkProse?: (languagecheck.ICheckResponse|null);

        /** Response getMetadata */
        getMetadata?: (languagecheck.IMetadataResponse|null);

        /** Response error */
        error?: (languagecheck.IErrorResponse|null);

        /** Response ok */
        ok?: (languagecheck.IOkResponse|null);
    }

    /** Represents a Response. */
    class Response implements IResponse {

        /**
         * Constructs a new Response.
         * @param [properties] Properties to set
         */
        constructor(properties?: languagecheck.IResponse);

        /** Response id. */
        public id: (number|Long);

        /** Response checkProse. */
        public checkProse?: (languagecheck.ICheckResponse|null);

        /** Response getMetadata. */
        public getMetadata?: (languagecheck.IMetadataResponse|null);

        /** Response error. */
        public error?: (languagecheck.IErrorResponse|null);

        /** Response ok. */
        public ok?: (languagecheck.IOkResponse|null);

        /** Response payload. */
        public payload?: ("checkProse"|"getMetadata"|"error"|"ok");

        /**
         * Creates a new Response instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Response instance
         */
        public static create(properties?: languagecheck.IResponse): languagecheck.Response;

        /**
         * Encodes the specified Response message. Does not implicitly {@link languagecheck.Response.verify|verify} messages.
         * @param message Response message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: languagecheck.IResponse, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Response message, length delimited. Does not implicitly {@link languagecheck.Response.verify|verify} messages.
         * @param message Response message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: languagecheck.IResponse, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Response message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Response
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): languagecheck.Response;

        /**
         * Decodes a Response message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Response
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): languagecheck.Response;

        /**
         * Verifies a Response message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a Response message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Response
         */
        public static fromObject(object: { [k: string]: any }): languagecheck.Response;

        /**
         * Creates a plain object from a Response message. Also converts values to other types if specified.
         * @param message Response
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: languagecheck.Response, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Response to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for Response
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of an OkResponse. */
    interface IOkResponse {
    }

    /** Represents an OkResponse. */
    class OkResponse implements IOkResponse {

        /**
         * Constructs a new OkResponse.
         * @param [properties] Properties to set
         */
        constructor(properties?: languagecheck.IOkResponse);

        /**
         * Creates a new OkResponse instance using the specified properties.
         * @param [properties] Properties to set
         * @returns OkResponse instance
         */
        public static create(properties?: languagecheck.IOkResponse): languagecheck.OkResponse;

        /**
         * Encodes the specified OkResponse message. Does not implicitly {@link languagecheck.OkResponse.verify|verify} messages.
         * @param message OkResponse message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: languagecheck.IOkResponse, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified OkResponse message, length delimited. Does not implicitly {@link languagecheck.OkResponse.verify|verify} messages.
         * @param message OkResponse message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: languagecheck.IOkResponse, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an OkResponse message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns OkResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): languagecheck.OkResponse;

        /**
         * Decodes an OkResponse message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns OkResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): languagecheck.OkResponse;

        /**
         * Verifies an OkResponse message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an OkResponse message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns OkResponse
         */
        public static fromObject(object: { [k: string]: any }): languagecheck.OkResponse;

        /**
         * Creates a plain object from an OkResponse message. Also converts values to other types if specified.
         * @param message OkResponse
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: languagecheck.OkResponse, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this OkResponse to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for OkResponse
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of an ErrorResponse. */
    interface IErrorResponse {

        /** ErrorResponse message */
        message?: (string|null);
    }

    /** Represents an ErrorResponse. */
    class ErrorResponse implements IErrorResponse {

        /**
         * Constructs a new ErrorResponse.
         * @param [properties] Properties to set
         */
        constructor(properties?: languagecheck.IErrorResponse);

        /** ErrorResponse message. */
        public message: string;

        /**
         * Creates a new ErrorResponse instance using the specified properties.
         * @param [properties] Properties to set
         * @returns ErrorResponse instance
         */
        public static create(properties?: languagecheck.IErrorResponse): languagecheck.ErrorResponse;

        /**
         * Encodes the specified ErrorResponse message. Does not implicitly {@link languagecheck.ErrorResponse.verify|verify} messages.
         * @param message ErrorResponse message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: languagecheck.IErrorResponse, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified ErrorResponse message, length delimited. Does not implicitly {@link languagecheck.ErrorResponse.verify|verify} messages.
         * @param message ErrorResponse message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: languagecheck.IErrorResponse, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an ErrorResponse message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns ErrorResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): languagecheck.ErrorResponse;

        /**
         * Decodes an ErrorResponse message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns ErrorResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): languagecheck.ErrorResponse;

        /**
         * Verifies an ErrorResponse message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an ErrorResponse message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns ErrorResponse
         */
        public static fromObject(object: { [k: string]: any }): languagecheck.ErrorResponse;

        /**
         * Creates a plain object from an ErrorResponse message. Also converts values to other types if specified.
         * @param message ErrorResponse
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: languagecheck.ErrorResponse, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this ErrorResponse to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for ErrorResponse
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
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
        public static create(rpcImpl: $protobuf.RPCImpl, requestDelimited?: boolean, responseDelimited?: boolean): CheckerProvider;

        /**
         * Calls CheckProse.
         * @param request CheckRequest message or plain object
         * @param callback Node-style callback called with the error, if any, and CheckResponse
         */
        public checkProse(request: languagecheck.ICheckRequest, callback: languagecheck.CheckerProvider.CheckProseCallback): void;

        /**
         * Calls CheckProse.
         * @param request CheckRequest message or plain object
         * @returns Promise
         */
        public checkProse(request: languagecheck.ICheckRequest): Promise<languagecheck.CheckResponse>;

        /**
         * Calls GetMetadata.
         * @param request MetadataRequest message or plain object
         * @param callback Node-style callback called with the error, if any, and MetadataResponse
         */
        public getMetadata(request: languagecheck.IMetadataRequest, callback: languagecheck.CheckerProvider.GetMetadataCallback): void;

        /**
         * Calls GetMetadata.
         * @param request MetadataRequest message or plain object
         * @returns Promise
         */
        public getMetadata(request: languagecheck.IMetadataRequest): Promise<languagecheck.MetadataResponse>;
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

    /** Properties of a CheckRequest. */
    interface ICheckRequest {

        /** CheckRequest text */
        text?: (string|null);

        /** CheckRequest languageId */
        languageId?: (string|null);

        /** CheckRequest settings */
        settings?: ({ [k: string]: string }|null);

        /** CheckRequest filePath */
        filePath?: (string|null);
    }

    /** Represents a CheckRequest. */
    class CheckRequest implements ICheckRequest {

        /**
         * Constructs a new CheckRequest.
         * @param [properties] Properties to set
         */
        constructor(properties?: languagecheck.ICheckRequest);

        /** CheckRequest text. */
        public text: string;

        /** CheckRequest languageId. */
        public languageId: string;

        /** CheckRequest settings. */
        public settings: { [k: string]: string };

        /** CheckRequest filePath. */
        public filePath?: (string|null);

        /**
         * Creates a new CheckRequest instance using the specified properties.
         * @param [properties] Properties to set
         * @returns CheckRequest instance
         */
        public static create(properties?: languagecheck.ICheckRequest): languagecheck.CheckRequest;

        /**
         * Encodes the specified CheckRequest message. Does not implicitly {@link languagecheck.CheckRequest.verify|verify} messages.
         * @param message CheckRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: languagecheck.ICheckRequest, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified CheckRequest message, length delimited. Does not implicitly {@link languagecheck.CheckRequest.verify|verify} messages.
         * @param message CheckRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: languagecheck.ICheckRequest, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a CheckRequest message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns CheckRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): languagecheck.CheckRequest;

        /**
         * Decodes a CheckRequest message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns CheckRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): languagecheck.CheckRequest;

        /**
         * Verifies a CheckRequest message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a CheckRequest message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns CheckRequest
         */
        public static fromObject(object: { [k: string]: any }): languagecheck.CheckRequest;

        /**
         * Creates a plain object from a CheckRequest message. Also converts values to other types if specified.
         * @param message CheckRequest
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: languagecheck.CheckRequest, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this CheckRequest to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for CheckRequest
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a CheckResponse. */
    interface ICheckResponse {

        /** CheckResponse diagnostics */
        diagnostics?: (languagecheck.IDiagnostic[]|null);

        /** CheckResponse extraction */
        extraction?: (languagecheck.IExtractionInfo|null);

        /** CheckResponse engineHealth */
        engineHealth?: (languagecheck.IEngineHealth[]|null);
    }

    /** Represents a CheckResponse. */
    class CheckResponse implements ICheckResponse {

        /**
         * Constructs a new CheckResponse.
         * @param [properties] Properties to set
         */
        constructor(properties?: languagecheck.ICheckResponse);

        /** CheckResponse diagnostics. */
        public diagnostics: languagecheck.IDiagnostic[];

        /** CheckResponse extraction. */
        public extraction?: (languagecheck.IExtractionInfo|null);

        /** CheckResponse engineHealth. */
        public engineHealth: languagecheck.IEngineHealth[];

        /**
         * Creates a new CheckResponse instance using the specified properties.
         * @param [properties] Properties to set
         * @returns CheckResponse instance
         */
        public static create(properties?: languagecheck.ICheckResponse): languagecheck.CheckResponse;

        /**
         * Encodes the specified CheckResponse message. Does not implicitly {@link languagecheck.CheckResponse.verify|verify} messages.
         * @param message CheckResponse message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: languagecheck.ICheckResponse, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified CheckResponse message, length delimited. Does not implicitly {@link languagecheck.CheckResponse.verify|verify} messages.
         * @param message CheckResponse message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: languagecheck.ICheckResponse, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a CheckResponse message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns CheckResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): languagecheck.CheckResponse;

        /**
         * Decodes a CheckResponse message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns CheckResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): languagecheck.CheckResponse;

        /**
         * Verifies a CheckResponse message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a CheckResponse message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns CheckResponse
         */
        public static fromObject(object: { [k: string]: any }): languagecheck.CheckResponse;

        /**
         * Creates a plain object from a CheckResponse message. Also converts values to other types if specified.
         * @param message CheckResponse
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: languagecheck.CheckResponse, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this CheckResponse to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for CheckResponse
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of an EngineHealth. */
    interface IEngineHealth {

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
    }

    /** Represents an EngineHealth. */
    class EngineHealth implements IEngineHealth {

        /**
         * Constructs a new EngineHealth.
         * @param [properties] Properties to set
         */
        constructor(properties?: languagecheck.IEngineHealth);

        /** EngineHealth name. */
        public name: string;

        /** EngineHealth status. */
        public status: string;

        /** EngineHealth consecutiveFailures. */
        public consecutiveFailures: number;

        /** EngineHealth lastError. */
        public lastError: string;

        /** EngineHealth lastSuccessEpochMs. */
        public lastSuccessEpochMs: (number|Long);

        /**
         * Creates a new EngineHealth instance using the specified properties.
         * @param [properties] Properties to set
         * @returns EngineHealth instance
         */
        public static create(properties?: languagecheck.IEngineHealth): languagecheck.EngineHealth;

        /**
         * Encodes the specified EngineHealth message. Does not implicitly {@link languagecheck.EngineHealth.verify|verify} messages.
         * @param message EngineHealth message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: languagecheck.IEngineHealth, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified EngineHealth message, length delimited. Does not implicitly {@link languagecheck.EngineHealth.verify|verify} messages.
         * @param message EngineHealth message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: languagecheck.IEngineHealth, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an EngineHealth message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns EngineHealth
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): languagecheck.EngineHealth;

        /**
         * Decodes an EngineHealth message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns EngineHealth
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): languagecheck.EngineHealth;

        /**
         * Verifies an EngineHealth message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an EngineHealth message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns EngineHealth
         */
        public static fromObject(object: { [k: string]: any }): languagecheck.EngineHealth;

        /**
         * Creates a plain object from an EngineHealth message. Also converts values to other types if specified.
         * @param message EngineHealth
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: languagecheck.EngineHealth, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this EngineHealth to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for EngineHealth
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of an ExtractionExclusion. */
    interface IExtractionExclusion {

        /** ExtractionExclusion startByte */
        startByte?: (number|null);

        /** ExtractionExclusion endByte */
        endByte?: (number|null);
    }

    /** Represents an ExtractionExclusion. */
    class ExtractionExclusion implements IExtractionExclusion {

        /**
         * Constructs a new ExtractionExclusion.
         * @param [properties] Properties to set
         */
        constructor(properties?: languagecheck.IExtractionExclusion);

        /** ExtractionExclusion startByte. */
        public startByte: number;

        /** ExtractionExclusion endByte. */
        public endByte: number;

        /**
         * Creates a new ExtractionExclusion instance using the specified properties.
         * @param [properties] Properties to set
         * @returns ExtractionExclusion instance
         */
        public static create(properties?: languagecheck.IExtractionExclusion): languagecheck.ExtractionExclusion;

        /**
         * Encodes the specified ExtractionExclusion message. Does not implicitly {@link languagecheck.ExtractionExclusion.verify|verify} messages.
         * @param message ExtractionExclusion message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: languagecheck.IExtractionExclusion, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified ExtractionExclusion message, length delimited. Does not implicitly {@link languagecheck.ExtractionExclusion.verify|verify} messages.
         * @param message ExtractionExclusion message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: languagecheck.IExtractionExclusion, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an ExtractionExclusion message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns ExtractionExclusion
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): languagecheck.ExtractionExclusion;

        /**
         * Decodes an ExtractionExclusion message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns ExtractionExclusion
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): languagecheck.ExtractionExclusion;

        /**
         * Verifies an ExtractionExclusion message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an ExtractionExclusion message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns ExtractionExclusion
         */
        public static fromObject(object: { [k: string]: any }): languagecheck.ExtractionExclusion;

        /**
         * Creates a plain object from an ExtractionExclusion message. Also converts values to other types if specified.
         * @param message ExtractionExclusion
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: languagecheck.ExtractionExclusion, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this ExtractionExclusion to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for ExtractionExclusion
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of an ExtractionProseRange. */
    interface IExtractionProseRange {

        /** ExtractionProseRange startByte */
        startByte?: (number|null);

        /** ExtractionProseRange endByte */
        endByte?: (number|null);

        /** ExtractionProseRange exclusions */
        exclusions?: (languagecheck.IExtractionExclusion[]|null);
    }

    /** Represents an ExtractionProseRange. */
    class ExtractionProseRange implements IExtractionProseRange {

        /**
         * Constructs a new ExtractionProseRange.
         * @param [properties] Properties to set
         */
        constructor(properties?: languagecheck.IExtractionProseRange);

        /** ExtractionProseRange startByte. */
        public startByte: number;

        /** ExtractionProseRange endByte. */
        public endByte: number;

        /** ExtractionProseRange exclusions. */
        public exclusions: languagecheck.IExtractionExclusion[];

        /**
         * Creates a new ExtractionProseRange instance using the specified properties.
         * @param [properties] Properties to set
         * @returns ExtractionProseRange instance
         */
        public static create(properties?: languagecheck.IExtractionProseRange): languagecheck.ExtractionProseRange;

        /**
         * Encodes the specified ExtractionProseRange message. Does not implicitly {@link languagecheck.ExtractionProseRange.verify|verify} messages.
         * @param message ExtractionProseRange message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: languagecheck.IExtractionProseRange, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified ExtractionProseRange message, length delimited. Does not implicitly {@link languagecheck.ExtractionProseRange.verify|verify} messages.
         * @param message ExtractionProseRange message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: languagecheck.IExtractionProseRange, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an ExtractionProseRange message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns ExtractionProseRange
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): languagecheck.ExtractionProseRange;

        /**
         * Decodes an ExtractionProseRange message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns ExtractionProseRange
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): languagecheck.ExtractionProseRange;

        /**
         * Verifies an ExtractionProseRange message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an ExtractionProseRange message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns ExtractionProseRange
         */
        public static fromObject(object: { [k: string]: any }): languagecheck.ExtractionProseRange;

        /**
         * Creates a plain object from an ExtractionProseRange message. Also converts values to other types if specified.
         * @param message ExtractionProseRange
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: languagecheck.ExtractionProseRange, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this ExtractionProseRange to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for ExtractionProseRange
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of an ExtractionInfo. */
    interface IExtractionInfo {

        /** ExtractionInfo proseRanges */
        proseRanges?: (languagecheck.IExtractionProseRange[]|null);
    }

    /** Represents an ExtractionInfo. */
    class ExtractionInfo implements IExtractionInfo {

        /**
         * Constructs a new ExtractionInfo.
         * @param [properties] Properties to set
         */
        constructor(properties?: languagecheck.IExtractionInfo);

        /** ExtractionInfo proseRanges. */
        public proseRanges: languagecheck.IExtractionProseRange[];

        /**
         * Creates a new ExtractionInfo instance using the specified properties.
         * @param [properties] Properties to set
         * @returns ExtractionInfo instance
         */
        public static create(properties?: languagecheck.IExtractionInfo): languagecheck.ExtractionInfo;

        /**
         * Encodes the specified ExtractionInfo message. Does not implicitly {@link languagecheck.ExtractionInfo.verify|verify} messages.
         * @param message ExtractionInfo message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: languagecheck.IExtractionInfo, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified ExtractionInfo message, length delimited. Does not implicitly {@link languagecheck.ExtractionInfo.verify|verify} messages.
         * @param message ExtractionInfo message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: languagecheck.IExtractionInfo, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an ExtractionInfo message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns ExtractionInfo
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): languagecheck.ExtractionInfo;

        /**
         * Decodes an ExtractionInfo message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns ExtractionInfo
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): languagecheck.ExtractionInfo;

        /**
         * Verifies an ExtractionInfo message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an ExtractionInfo message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns ExtractionInfo
         */
        public static fromObject(object: { [k: string]: any }): languagecheck.ExtractionInfo;

        /**
         * Creates a plain object from an ExtractionInfo message. Also converts values to other types if specified.
         * @param message ExtractionInfo
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: languagecheck.ExtractionInfo, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this ExtractionInfo to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for ExtractionInfo
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a Diagnostic. */
    interface IDiagnostic {

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
    }

    /** Represents a Diagnostic. */
    class Diagnostic implements IDiagnostic {

        /**
         * Constructs a new Diagnostic.
         * @param [properties] Properties to set
         */
        constructor(properties?: languagecheck.IDiagnostic);

        /** Diagnostic startByte. */
        public startByte: number;

        /** Diagnostic endByte. */
        public endByte: number;

        /** Diagnostic message. */
        public message: string;

        /** Diagnostic suggestions. */
        public suggestions: string[];

        /** Diagnostic ruleId. */
        public ruleId: string;

        /** Diagnostic severity. */
        public severity: languagecheck.Severity;

        /** Diagnostic unifiedId. */
        public unifiedId: string;

        /** Diagnostic confidence. */
        public confidence: number;

        /**
         * Creates a new Diagnostic instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Diagnostic instance
         */
        public static create(properties?: languagecheck.IDiagnostic): languagecheck.Diagnostic;

        /**
         * Encodes the specified Diagnostic message. Does not implicitly {@link languagecheck.Diagnostic.verify|verify} messages.
         * @param message Diagnostic message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: languagecheck.IDiagnostic, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Diagnostic message, length delimited. Does not implicitly {@link languagecheck.Diagnostic.verify|verify} messages.
         * @param message Diagnostic message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: languagecheck.IDiagnostic, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Diagnostic message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Diagnostic
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): languagecheck.Diagnostic;

        /**
         * Decodes a Diagnostic message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Diagnostic
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): languagecheck.Diagnostic;

        /**
         * Verifies a Diagnostic message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a Diagnostic message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Diagnostic
         */
        public static fromObject(object: { [k: string]: any }): languagecheck.Diagnostic;

        /**
         * Creates a plain object from a Diagnostic message. Also converts values to other types if specified.
         * @param message Diagnostic
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: languagecheck.Diagnostic, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Diagnostic to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for Diagnostic
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Severity enum. */
    enum Severity {
        SEVERITY_UNSPECIFIED = 0,
        SEVERITY_INFORMATION = 1,
        SEVERITY_WARNING = 2,
        SEVERITY_ERROR = 3,
        SEVERITY_HINT = 4
    }

    /** Properties of an AddDictionaryWordRequest. */
    interface IAddDictionaryWordRequest {

        /** AddDictionaryWordRequest word */
        word?: (string|null);
    }

    /** Represents an AddDictionaryWordRequest. */
    class AddDictionaryWordRequest implements IAddDictionaryWordRequest {

        /**
         * Constructs a new AddDictionaryWordRequest.
         * @param [properties] Properties to set
         */
        constructor(properties?: languagecheck.IAddDictionaryWordRequest);

        /** AddDictionaryWordRequest word. */
        public word: string;

        /**
         * Creates a new AddDictionaryWordRequest instance using the specified properties.
         * @param [properties] Properties to set
         * @returns AddDictionaryWordRequest instance
         */
        public static create(properties?: languagecheck.IAddDictionaryWordRequest): languagecheck.AddDictionaryWordRequest;

        /**
         * Encodes the specified AddDictionaryWordRequest message. Does not implicitly {@link languagecheck.AddDictionaryWordRequest.verify|verify} messages.
         * @param message AddDictionaryWordRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: languagecheck.IAddDictionaryWordRequest, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified AddDictionaryWordRequest message, length delimited. Does not implicitly {@link languagecheck.AddDictionaryWordRequest.verify|verify} messages.
         * @param message AddDictionaryWordRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: languagecheck.IAddDictionaryWordRequest, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an AddDictionaryWordRequest message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns AddDictionaryWordRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): languagecheck.AddDictionaryWordRequest;

        /**
         * Decodes an AddDictionaryWordRequest message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns AddDictionaryWordRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): languagecheck.AddDictionaryWordRequest;

        /**
         * Verifies an AddDictionaryWordRequest message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an AddDictionaryWordRequest message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns AddDictionaryWordRequest
         */
        public static fromObject(object: { [k: string]: any }): languagecheck.AddDictionaryWordRequest;

        /**
         * Creates a plain object from an AddDictionaryWordRequest message. Also converts values to other types if specified.
         * @param message AddDictionaryWordRequest
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: languagecheck.AddDictionaryWordRequest, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this AddDictionaryWordRequest to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for AddDictionaryWordRequest
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a MetadataRequest. */
    interface IMetadataRequest {
    }

    /** Represents a MetadataRequest. */
    class MetadataRequest implements IMetadataRequest {

        /**
         * Constructs a new MetadataRequest.
         * @param [properties] Properties to set
         */
        constructor(properties?: languagecheck.IMetadataRequest);

        /**
         * Creates a new MetadataRequest instance using the specified properties.
         * @param [properties] Properties to set
         * @returns MetadataRequest instance
         */
        public static create(properties?: languagecheck.IMetadataRequest): languagecheck.MetadataRequest;

        /**
         * Encodes the specified MetadataRequest message. Does not implicitly {@link languagecheck.MetadataRequest.verify|verify} messages.
         * @param message MetadataRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: languagecheck.IMetadataRequest, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified MetadataRequest message, length delimited. Does not implicitly {@link languagecheck.MetadataRequest.verify|verify} messages.
         * @param message MetadataRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: languagecheck.IMetadataRequest, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a MetadataRequest message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns MetadataRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): languagecheck.MetadataRequest;

        /**
         * Decodes a MetadataRequest message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns MetadataRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): languagecheck.MetadataRequest;

        /**
         * Verifies a MetadataRequest message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a MetadataRequest message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns MetadataRequest
         */
        public static fromObject(object: { [k: string]: any }): languagecheck.MetadataRequest;

        /**
         * Creates a plain object from a MetadataRequest message. Also converts values to other types if specified.
         * @param message MetadataRequest
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: languagecheck.MetadataRequest, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this MetadataRequest to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for MetadataRequest
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a MetadataResponse. */
    interface IMetadataResponse {

        /** MetadataResponse name */
        name?: (string|null);

        /** MetadataResponse version */
        version?: (string|null);

        /** MetadataResponse supportedLanguages */
        supportedLanguages?: (string[]|null);
    }

    /** Represents a MetadataResponse. */
    class MetadataResponse implements IMetadataResponse {

        /**
         * Constructs a new MetadataResponse.
         * @param [properties] Properties to set
         */
        constructor(properties?: languagecheck.IMetadataResponse);

        /** MetadataResponse name. */
        public name: string;

        /** MetadataResponse version. */
        public version: string;

        /** MetadataResponse supportedLanguages. */
        public supportedLanguages: string[];

        /**
         * Creates a new MetadataResponse instance using the specified properties.
         * @param [properties] Properties to set
         * @returns MetadataResponse instance
         */
        public static create(properties?: languagecheck.IMetadataResponse): languagecheck.MetadataResponse;

        /**
         * Encodes the specified MetadataResponse message. Does not implicitly {@link languagecheck.MetadataResponse.verify|verify} messages.
         * @param message MetadataResponse message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: languagecheck.IMetadataResponse, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified MetadataResponse message, length delimited. Does not implicitly {@link languagecheck.MetadataResponse.verify|verify} messages.
         * @param message MetadataResponse message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: languagecheck.IMetadataResponse, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a MetadataResponse message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns MetadataResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): languagecheck.MetadataResponse;

        /**
         * Decodes a MetadataResponse message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns MetadataResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): languagecheck.MetadataResponse;

        /**
         * Verifies a MetadataResponse message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a MetadataResponse message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns MetadataResponse
         */
        public static fromObject(object: { [k: string]: any }): languagecheck.MetadataResponse;

        /**
         * Creates a plain object from a MetadataResponse message. Also converts values to other types if specified.
         * @param message MetadataResponse
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: languagecheck.MetadataResponse, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this MetadataResponse to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for MetadataResponse
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }
}
