Pod::Spec.new do |s|
  s.name           = 'HaDiscovery'
  s.version        = '1.0.0'
  s.summary        = 'Finds Home Assistant on the local network over Bonjour.'
  s.author         = ''
  s.homepage       = 'https://github.com/expo/expo'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end
