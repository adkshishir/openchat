# WhatsApp OpenClaw QR start/wait exceeds the gem default of 15s.
# Must be set before requiring rack-timeout so the middleware picks it up.
ENV['RACK_TIMEOUT_SERVICE_TIMEOUT'] ||= '60'

require 'rack-timeout'

# Reduce noise by filtering state=ready and state=completed which are logged at INFO level
Rails.application.config.after_initialize do
  Rack::Timeout::Logger.level = Logger::ERROR
end
