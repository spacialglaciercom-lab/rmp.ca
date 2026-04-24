Pod::Spec.new do |s|
  s.name             = 'MapsMeReactNative'
  s.version          = '0.1.0'
  s.summary          = 'React Native wrapper for MAPS.ME'
  s.description      = 'React Native bridge for MAPS.ME offline maps functionality'
  s.homepage         = 'https://github.com/mapsme/omim'
  s.license          = { :type => 'Apache 2.0', :file => 'LICENSE' }
  s.author           = { 'MAPS.ME Team' => 'https://maps.me' }
  s.source           = { :git => 'https://github.com/mapsme/omim.git', :tag => s.version.to_s }

  s.platform     = :ios, '11.0'
  s.requires_arc = true

  s.source_files = '**/*.{h,m,mm}'
  s.dependency 'React'
  s.dependency 'React-Core'
  s.dependency 'React-RCTText'
  s.dependency 'React-RCTImage'
  s.dependency 'React-RCTNetwork'
  s.dependency 'React-RCTWebSocket'

  # Depend on the main MAPS.ME framework
  s.dependency 'CoreApi'
end