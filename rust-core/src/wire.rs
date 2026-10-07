//! Facts about the protobuf wire format that both stdio front ends (the
//! server, and the browser's native host in front of it) need.

/// The id of a request that does not decode as a whole, read from its first field.
///
/// Answering a broken request under its own id lets the client fail that call
/// at once; filed under 0, it waits out its timeout instead.
#[must_use]
pub fn leading_request_id(bytes: &[u8]) -> Option<u64> {
    // Tag byte for field 1, wire type 0 (varint).
    let rest = bytes.strip_prefix(&[0x08])?;
    let mut id: u64 = 0;
    for (i, &byte) in rest.iter().take(10).enumerate() {
        id |= u64::from(byte & 0x7f) << (7 * i);
        if byte & 0x80 == 0 {
            return Some(id);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::checker::Request;
    use prost::Message;

    #[test]
    fn the_id_of_an_undecodable_request_is_still_read() {
        let mut bytes = Request {
            id: 300,
            payload: None,
        }
        .encode_to_vec();
        // A field 2 that claims more bytes than follow: not decodable.
        bytes.extend_from_slice(&[0x12, 0x7f, 0x01]);
        assert!(Request::decode(bytes.as_slice()).is_err());
        assert_eq!(leading_request_id(&bytes), Some(300));
        assert_eq!(leading_request_id(&[0x12, 0x00]), None);
        assert_eq!(leading_request_id(&[0x08, 0xff]), None);
    }
}
