class Api::V1::Accounts::OpenchatController < Api::V1::Accounts::BaseController
  before_action :check_authorization

  rescue_from Openchat::BridgeClient::Error do |error|
    render json: { error: error.message }, status: :bad_gateway
  end

  def web_widget
    ensure_provisioned!
    inbox = create_web_widget_inbox
    attach_openclaw_agent(inbox)
    Openchat::BridgeClient.new.register_web_widget(account_id: Current.account.id, inbox_id: inbox.id)
    render json: {
      id: inbox.id,
      name: inbox.name,
      web_widget_script: inbox.channel.web_widget_script,
      website_token: inbox.channel.website_token,
      ai_enabled: true
    }
  end

  def settings
    payload = Openchat::BridgeClient.new.settings(account_id: Current.account.id)
    render json: payload.merge(local_ai_enabled: Current.account.custom_attributes['openchat_ai_enabled'] != false)
  end

  def update_settings
    ai_enabled = ActiveModel::Type::Boolean.new.cast(params[:ai_enabled])
    Current.account.update!(custom_attributes: (Current.account.custom_attributes || {}).merge('openchat_ai_enabled' => ai_enabled))
    payload = Openchat::BridgeClient.new.update_settings(account_id: Current.account.id, ai_enabled: ai_enabled)
    render json: payload
  end

  def whatsapp_start
    ensure_provisioned!
    # force only when explicitly requested (Regenerate). A live scan must not be
    # logged out by a second accidental start.
    force = ActiveModel::Type::Boolean.new.cast(params[:force])
    force = true if force.nil? # legacy clients always meant "get a fresh QR"
    render json: Openchat::BridgeClient.new.start_whatsapp(account_id: Current.account.id, force: force)
  end

  def whatsapp_wait
    # Do not re-provision on every 2–5s poll — that stacked bridge HTTP calls and
    # caused Net::ReadTimeout while WhatsApp QR wait was already in flight.
    payload = Openchat::BridgeClient.new.wait_whatsapp(account_id: Current.account.id)
    if whatsapp_connected?(payload) && payload['inbox_id'].blank?
      inbox = ensure_openclaw_channel_inbox!('whatsapp', 'WhatsApp (OpenClaw)')
      Openchat::BridgeClient.new.register_whatsapp_inbox(
        account_id: Current.account.id,
        inbox_id: inbox.id,
        inbox_identifier: inbox.channel.try(:identifier)
      )
      payload = payload.merge('inbox_id' => inbox.id)
    end
    render json: payload
  end

  # Called after the browser WebSocket reports WhatsApp connected (no more HTTP poll).
  def whatsapp_finalize
    ensure_provisioned!
    inbox = ensure_openclaw_channel_inbox!('whatsapp', 'WhatsApp (OpenClaw)')
    Openchat::BridgeClient.new.register_whatsapp_inbox(
      account_id: Current.account.id,
      inbox_id: inbox.id,
      inbox_identifier: inbox.channel.try(:identifier)
    )
    render json: {
      connected: true,
      inbox_id: inbox.id,
      message: 'WhatsApp linked via OpenClaw.'
    }
  end

  def channels
    ensure_provisioned!
    render json: Openchat::BridgeClient.new.channels_catalog(account_id: Current.account.id)
  end

  def channel_connect
    ensure_provisioned!
    channel = params.require(:channel).to_s.downcase
    fields = params[:fields].present? ? params.require(:fields).permit!.to_h : {}
    payload = Openchat::BridgeClient.new.connect_channel(
      account_id: Current.account.id,
      channel: channel,
      fields: fields
    )
    if ActiveModel::Type::Boolean.new.cast(payload['connected']) && payload['inbox_id'].blank?
      label = payload['label'].presence || channel.capitalize
      inbox = ensure_openclaw_channel_inbox!(channel, "#{label} (OpenClaw)")
      Openchat::BridgeClient.new.register_channel_inbox(
        account_id: Current.account.id,
        channel: channel,
        inbox_id: inbox.id,
        inbox_identifier: inbox.channel.try(:identifier)
      )
      payload = payload.merge('inbox_id' => inbox.id)
    end
    render json: payload
  end

  def channel_finalize
    ensure_provisioned!
    channel = params.require(:channel).to_s.downcase
    label = params[:label].presence || channel.capitalize
    inbox = ensure_openclaw_channel_inbox!(channel, "#{label} (OpenClaw)")
    Openchat::BridgeClient.new.register_channel_inbox(
      account_id: Current.account.id,
      channel: channel,
      inbox_id: inbox.id,
      inbox_identifier: inbox.channel.try(:identifier)
    )
    render json: { connected: true, inbox_id: inbox.id, channel: channel }
  end

  def knowledge_index
    ensure_provisioned!
    render json: Openchat::BridgeClient.new.knowledge_sources(account_id: Current.account.id)
  end

  def knowledge_upload
    ensure_provisioned!
    uploaded_file = params.require(:file)
    render json: Openchat::BridgeClient.new.upload_knowledge(account_id: Current.account.id, uploaded_file: uploaded_file)
  end

  def knowledge_destroy
    ensure_provisioned!
    render json: Openchat::BridgeClient.new.delete_knowledge_source(account_id: Current.account.id, source_id: params.require(:id))
  end

  def knowledge_search
    ensure_provisioned!
    render json: Openchat::BridgeClient.new.search_knowledge(account_id: Current.account.id, query: params.require(:query))
  end

  def model_auth
    ensure_provisioned!
    render json: Openchat::BridgeClient.new.start_model_auth(
      account_id: Current.account.id,
      provider: params[:provider].presence || 'openai'
    )
  end

  def openclaw_status
    ensure_provisioned!
    render json: Openchat::BridgeClient.new.openclaw_status(account_id: Current.account.id)
  end

  def openclaw_workspace
    ensure_provisioned!
    render json: Openchat::BridgeClient.new.openclaw_workspace(account_id: Current.account.id)
  end

  def openclaw_workspace_file
    ensure_provisioned!
    render json: Openchat::BridgeClient.new.openclaw_workspace_file(
      account_id: Current.account.id,
      file: workspace_file_param
    )
  end

  def update_openclaw_workspace_file
    ensure_provisioned!
    render json: Openchat::BridgeClient.new.update_openclaw_workspace_file(
      account_id: Current.account.id,
      file: workspace_file_param,
      content: params.require(:content).to_s
    )
  end

  def whatsapp_compose
    ensure_provisioned!
    result = Openchat::WhatsappComposeService.new(account: Current.account, user: Current.user).perform(
      phone: params.require(:phone),
      content: params.require(:content)
    )
    render json: result
  rescue Openchat::WhatsappComposeService::Error => e
    render json: { error: e.message }, status: :unprocessable_entity
  end

  private

  def check_authorization
    authorize :openchat, :manage?
  end

  def ensure_provisioned!
    Openchat::ProvisionService.new(account: Current.account, user: Current.user).perform
  end

  # The route declares format: false and a constraint that includes dots, so
  # params[:file] is already the exact filename (e.g. "SOUL.md"). params[:format]
  # is just the API-wide default ("json") here, not a stripped file extension —
  # appending it used to corrupt every filename into "SOUL.md.json".
  def workspace_file_param
    name = params[:file].to_s
    raise ActionController::ParameterMissing, :file if name.blank?

    name
  end

  def whatsapp_connected?(payload)
    ActiveModel::Type::Boolean.new.cast(payload['connected'])
  end

  # AgentBot API tokens cannot create inboxes ("not authorized for bots").
  # Create the API inbox as the signed-in administrator instead.
  def ensure_openclaw_channel_inbox!(channel_key, inbox_name)
    existing = Current.account.inboxes.find_by(name: inbox_name, channel_type: 'Channel::Api')
    if existing
      sync_api_channel_webhook_secret!(existing.channel)
      return existing
    end

    webhook_url = "#{ENV.fetch('OPENCHAT_BRIDGE_URL', 'http://localhost:8090')}/webhooks/chatwoot/#{Current.account.id}"
    channel = Current.account.api_channels.create!(webhook_url: webhook_url)
    inbox = Current.account.inboxes.create!(name: inbox_name, channel: channel)
    InboxMember.find_or_create_by!(inbox: inbox, user: Current.user) if Current.user
    attach_openclaw_agent(inbox)
    sync_api_channel_webhook_secret!(channel)
    inbox
  end

  # Sync API channel webhook secret with OpenClaw agent bot secret.
  def sync_api_channel_webhook_secret!(channel)
    bot = openclaw_agent
    return unless bot&.secret.present? && channel.respond_to?(:secret=)
    return if channel.secret == bot.secret

    channel.update!(secret: bot.secret)
  end

  def create_web_widget_inbox
    website_url = params.require(:website_url)
    channel = Current.account.web_widgets.create!(
      website_url: website_url,
      widget_color: params[:widget_color].presence || '#1f93ff',
      welcome_title: params[:welcome_title].presence || Current.account.name,
      welcome_tagline: params[:welcome_tagline]
    )
    inbox = Current.account.inboxes.create!(name: params[:name].presence || Current.account.name, channel: channel)
    InboxMember.find_or_create_by!(inbox: inbox, user: Current.user) if Current.user
    inbox
  end

  def attach_openclaw_agent(inbox)
    Openchat::AttachOpenclawAgentService.new(account: Current.account).perform(inbox)
  end

  def openclaw_agent
    Openchat::AttachOpenclawAgentService.openclaw_bot_for(Current.account)
  end
end
