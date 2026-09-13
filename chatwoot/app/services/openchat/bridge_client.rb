# frozen_string_literal: true

require 'net/http'
require 'net/http/post/multipart'
require 'json'

class Openchat::BridgeClient
  class Error < StandardError; end

  DEFAULT_OPEN_TIMEOUT = 5
  DEFAULT_READ_TIMEOUT = 15
  # WhatsApp QR start/wait can take longer than Chatwoot's default rack timeout.
  WHATSAPP_READ_TIMEOUT = 55
  # Embedding a whole spreadsheet locally (Ollama) row-by-row is slow.
  KNOWLEDGE_UPLOAD_READ_TIMEOUT = 120

  def initialize(base_url: ENV.fetch('OPENCHAT_BRIDGE_URL', 'http://localhost:8090'))
    @base_url = base_url.to_s.chomp('/')
  end

  def provision(account:, agent_bot:, admin_user_id: nil)
    post('/provision', {
           chatwoot_account_id: account.id,
           admin_user_id: admin_user_id,
           agent_bot_id: agent_bot.id,
           agent_bot_access_token: agent_bot.access_token.token,
           agent_bot_secret: agent_bot.secret
         },
         headers: { 'X-Openchat-Provision-Secret' => ENV.fetch('OPENCHAT_PROVISION_SECRET', 'dev-provision-secret') })
  end

  def register_web_widget(account_id:, inbox_id:)
    post("/tenants/#{account_id}/channels/web_widget", { inbox_id: inbox_id })
  end

  def register_whatsapp_inbox(account_id:, inbox_id:, inbox_identifier: nil)
    post("/tenants/#{account_id}/channels/whatsapp", {
           inbox_id: inbox_id,
           inbox_identifier: inbox_identifier
         })
  end

  def channels_catalog(account_id:)
    get("/tenants/#{account_id}/channels")
  end

  def connect_channel(account_id:, channel:, fields:)
    post(
      "/tenants/#{account_id}/channels/#{channel}/connect",
      { fields: fields },
      read_timeout: 45
    )
  end

  def register_channel_inbox(account_id:, channel:, inbox_id:, inbox_identifier: nil)
    post("/tenants/#{account_id}/channels/#{channel}/register", {
           inbox_id: inbox_id,
           inbox_identifier: inbox_identifier
         })
  end

  def send_whatsapp(account_id:, to:, text:, conversation_id: nil)
    post("/tenants/#{account_id}/channels/whatsapp/send", {
           to: to,
           text: text,
           conversation_id: conversation_id
         })
  end

  def settings(account_id:)
    get("/tenants/#{account_id}/settings")
  end

  def update_settings(account_id:, ai_enabled:)
    patch("/tenants/#{account_id}/settings", { ai_enabled: ai_enabled })
  end

  def start_whatsapp(account_id:, force: true)
    post("/tenants/#{account_id}/channels/whatsapp/setup/start?force=#{force ? '1' : '0'}", { force: force }, read_timeout: WHATSAPP_READ_TIMEOUT)
  end

  def wait_whatsapp(account_id:, current_qr: nil)
    # Bridge caches the last QR server-side; skip huge PNG bodies that stall Rails.
    post(
      "/tenants/#{account_id}/channels/whatsapp/setup/wait",
      {},
      read_timeout: WHATSAPP_READ_TIMEOUT
    )
  end

  def start_model_auth(account_id:, provider:)
    post("/tenants/#{account_id}/models/auth/start", { provider: provider })
  end

  def openclaw_status(account_id:)
    get("/tenants/#{account_id}/openclaw/status", read_timeout: 20)
  end

  def openclaw_workspace(account_id:)
    get("/tenants/#{account_id}/openclaw/workspace")
  end

  def openclaw_workspace_file(account_id:, file:)
    get("/tenants/#{account_id}/openclaw/workspace/#{file}")
  end

  def update_openclaw_workspace_file(account_id:, file:, content:)
    put("/tenants/#{account_id}/openclaw/workspace/#{file}", { content: content })
  end

  def knowledge_sources(account_id:)
    get("/tenants/#{account_id}/knowledge")
  end

  def upload_knowledge(account_id:, uploaded_file:)
    uri = URI.parse("#{@base_url}/tenants/#{account_id}/knowledge/upload")
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = uri.scheme == 'https'
    http.open_timeout = DEFAULT_OPEN_TIMEOUT
    http.read_timeout = KNOWLEDGE_UPLOAD_READ_TIMEOUT
    req = Net::HTTP::Post::Multipart.new(
      uri.request_uri,
      'file' => UploadIO.new(uploaded_file.tempfile, uploaded_file.content_type, uploaded_file.original_filename)
    )
    res = http.request(req)
    raise Error, "OpenChat bridge #{res.code}: #{res.body}" unless res.is_a?(Net::HTTPSuccess)

    JSON.parse(res.body)
  rescue Errno::ECONNREFUSED, SocketError, Net::OpenTimeout, Net::ReadTimeout => e
    Rails.logger.warn("[OpenChat] Bridge unavailable: #{e.message}")
    raise Error, "OpenChat bridge unavailable: #{e.message}"
  end

  def delete_knowledge_source(account_id:, source_id:)
    delete("/tenants/#{account_id}/knowledge/#{source_id}")
  end

  def search_knowledge(account_id:, query:)
    post("/tenants/#{account_id}/knowledge/search", { query: query })
  end

  # Inbox deleted in Chatwoot -> drop its OpenClaw channel link + conversation maps.
  def teardown_channel(account_id:, inbox_id:)
    delete("/tenants/#{account_id}/channels/#{inbox_id}")
  end

  # Account deleted in Chatwoot -> full OpenClaw teardown for the tenant.
  def teardown_account(account_id:)
    delete("/tenants/#{account_id}")
  end

  private

  def get(path, read_timeout: DEFAULT_READ_TIMEOUT)
    request(Net::HTTP::Get, path, nil, {}, read_timeout: read_timeout)
  end

  def delete(path, read_timeout: DEFAULT_READ_TIMEOUT)
    request(Net::HTTP::Delete, path, nil, {}, read_timeout: read_timeout)
  end

  def put(path, body, read_timeout: DEFAULT_READ_TIMEOUT)
    request(Net::HTTP::Put, path, body, {}, read_timeout: read_timeout)
  end

  def patch(path, body)
    request(Net::HTTP::Patch, path, body)
  end

  def post(path, body, headers: {}, read_timeout: DEFAULT_READ_TIMEOUT)
    request(Net::HTTP::Post, path, body, headers, read_timeout: read_timeout)
  end

  def request(klass, path, body = nil, extra_headers = {}, read_timeout: DEFAULT_READ_TIMEOUT)
    uri = URI.parse("#{@base_url}#{path}")
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = uri.scheme == 'https'
    http.open_timeout = DEFAULT_OPEN_TIMEOUT
    http.read_timeout = read_timeout
    req = klass.new(uri.request_uri)
    req['Content-Type'] = 'application/json' if body
    extra_headers.each { |key, value| req[key] = value }
    req.body = body.to_json if body
    res = http.request(req)
    raise Error, "OpenChat bridge #{res.code}: #{res.body}" unless res.is_a?(Net::HTTPSuccess)

    JSON.parse(res.body)
  rescue Errno::ECONNREFUSED, SocketError, Net::OpenTimeout, Net::ReadTimeout => e
    Rails.logger.warn("[OpenChat] Bridge unavailable: #{e.message}")
    raise Error, "OpenChat bridge unavailable: #{e.message}"
  end
end
