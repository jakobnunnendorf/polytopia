// macOS extension modules leave the Python symbols to the interpreter (-undefined dynamic_lookup)
fn main() {
    pyo3_build_config::add_extension_module_link_args();
}
