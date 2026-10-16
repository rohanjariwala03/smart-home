Pod::Spec.new do |s|
  s.name           = 'MicStream'
  s.version        = '1.0.0'
  s.summary        = 'Streams the microphone as 16-bit PCM over a WebSocket (Blink push-to-talk).'
  s.author         = ''
  s.homepage       = 'https://github.com/expo/expo'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end
