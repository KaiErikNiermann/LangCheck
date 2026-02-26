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

        /** Request payload. */
        public payload?: ("checkProse"|"getMetadata");

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

        /** Response payload. */
        public payload?: ("checkProse"|"getMetadata"|"error");

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
