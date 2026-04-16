{
  "conditions": [
    ["OS=='linux'", {
      "targets": [
        {
          "target_name": "tiny_pony_clipper",
          "cflags!": [ "-fno-exceptions" ],
          "cflags_cc!": [ "-fno-exceptions" ],
          "cflags_cc": [ "-std=c++20" ],
          "sources": [ 
            "src/native/uinput_gamepad.cpp", 
            "src/native/test/webrtc_test.cpp",
            "src/native/main.cpp" 
          ],
          "include_dirs": [
            "<!@(node -p \"require('node-addon-api').include\")",
            "<(module_root_dir)/vendor/include",
            "<(module_root_dir)/vendor/include/third_party/abseil-cpp"
          ],
          "libraries": [
            "<(module_root_dir)/vendor/lib/libwebrtc.a",
            "-lpthread",
            "-lrt",
            "-ldl"
          ],
          "defines": [ 
            "NAPI_DISABLE_CPP_EXCEPTIONS",
            "WEBRTC_POSIX",
            "WEBRTC_LINUX"
          ]
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