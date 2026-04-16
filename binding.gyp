{
  "conditions": [
    ["OS=='linux'", {
      "targets": [
        {
          "target_name": "tiny_pony_clipper",
          "cflags!": [ "-fno-exceptions" ],
          "cflags_cc!": [ "-fno-exceptions" ],
          "sources": [ "src/native/uinput_gamepad.cpp", "src/native/main.cpp" ],
          "include_dirs": [
            "<!@(node -p \"require('node-addon-api').include\")"
          ],
          "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ]
        }
      ]
    }],
    ["OS=='win'", {
      "targets": [
        {
          "target_name": "tiny_pony_clipper",
          "libraries": [],
          "sources": [],
          "include_dirs": [],
          "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ]
        }
      ]
    }]
  ]
}