//! WebAssembly entry points, a plain C ABI so the module needs no generated
//! glue (logic/engine/rust.ts holds the few lines of JavaScript it needs):
//!
//!   ptr = alloc(len)                      memory for the caller to write into
//!   out = call(namePtr, nameLen, argsPtr, argsLen)
//!         -> pointer to [u32 little-endian length][UTF-8 JSON result]
//!   dealloc(ptr, len)                     free memory from alloc or call (len incl. the 4 bytes)

use std::alloc::{alloc as raw_alloc, dealloc as raw_dealloc, Layout};

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    if len == 0 {
        return std::ptr::NonNull::<u8>::dangling().as_ptr();
    }
    unsafe { raw_alloc(Layout::from_size_align(len, 1).unwrap()) }
}

/// # Safety
/// `ptr` and `len` must come from `alloc` or `call` of this module.
#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    if len != 0 {
        raw_dealloc(ptr, Layout::from_size_align(len, 1).unwrap());
    }
}

/// # Safety
/// The pointers must point to `len` valid bytes written by the caller.
#[no_mangle]
pub unsafe extern "C" fn call(name_ptr: *const u8, name_len: usize, args_ptr: *const u8, args_len: usize) -> *mut u8 {
    let name = std::str::from_utf8(std::slice::from_raw_parts(name_ptr, name_len)).unwrap_or("");
    let args = std::str::from_utf8(std::slice::from_raw_parts(args_ptr, args_len)).unwrap_or("[]");
    let out = polyapi::call_json(name, args);
    let bytes = out.as_bytes();
    let p = alloc(bytes.len() + 4);
    std::ptr::copy_nonoverlapping((bytes.len() as u32).to_le_bytes().as_ptr(), p, 4);
    std::ptr::copy_nonoverlapping(bytes.as_ptr(), p.add(4), bytes.len());
    p
}
