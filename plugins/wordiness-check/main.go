//go:build tinygo

package main

import (
	"encoding/json"

	"github.com/extism/go-pdk"
)

//export check
func check() int32 {
	input := pdk.Input()

	var req CheckRequest
	if err := json.Unmarshal(input, &req); err != nil {
		pdk.SetError(err)
		return 1
	}

	diagnostics := FindWordyPhrases(req.Text)

	output, err := json.Marshal(diagnostics)
	if err != nil {
		pdk.SetError(err)
		return 1
	}

	pdk.Output(output)
	return 0
}

func main() {}
