.PHONY: build test clean

WASM_OUT := wordiness-check.wasm

build:
	tinygo build -o $(WASM_OUT) -target wasi .

test:
	go test -v ./...

clean:
	rm -f $(WASM_OUT)
