class Api::V1::Accounts::OpenchatController < Api::V1::Accounts::BaseController
  before_action :check_authorization

  rescue_from Openchat::BridgeClient::Error do |error|
    render json: { error: error.message }, status: :bad_gateway
  end

  def web_widget
    ensure_provisioned!
    result = Openchat::WebWidgetProvisioner.new(
      account: Current.account,
      website_url: params.require(:website_url),
      widget_color: params[:widget_color],
      welcome_title: params[:welcome_title],
      welcome_tagline: params[:welcome_tagline],
      name: params[:name],
      user: Current.user
    ).perform
    render json: result
  end

  def agent_chat
    ensure_provisioned!
    result = Openchat::BridgeClient.new.admin_chat(
      account_id: Current.account.id,
      message: params.require(:message),
      history: params[:message_history].to_s
    )
    render json: { response: result['response'], whatsapp_qr: result['whatsapp_qr'] }
  end

  def settings
    payload = Openchat::BridgeClient.new.settings(account_id: Current.account.id)
    render json: payload.merge(local_ai_enabled: Current.account.custom_attributes['openchat_ai_enabled'] != false)
  end

  def update_settings
    ai_enabled = ActiveModel::Type::Boolean.new.cast(params[:ai_enabled]) if params.key?(:ai_enabled)
    if params.key?(:ai_enabled)
      Current.account.update!(custom_attributes: (Current.account.custom_attributes || {}).merge('openchat_ai_enabled' => ai_enabled))
    end
    payload = Openchat::BridgeClient.new.update_settings(
      account_id: Current.account.id,
      ai_enabled: ai_enabled,
      custom_prompt: params[:custom_prompt]
    )
    render json: payload
  end

  # The browser needs this to talk to the bridge's WhatsApp QR WebSocket directly
  # (the one bridge surface not proxied through this controller) without using
  # Chatwoot's own guessable sequential account id in that URL.
  def bridge_tenant_id
    ensure_provisioned!
    render json: { tenant_id: Current.account.custom_attributes['openchat_tenant_id'] }
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

  def orders_index
    ensure_provisioned!
    render json: Openchat::BridgeClient.new.orders(account_id: Current.account.id)
  end

  def orders_update
    ensure_provisioned!
    render json: Openchat::BridgeClient.new.update_order(
      account_id: Current.account.id,
      order_id: params.require(:id),
      status: params.require(:status)
    )
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
  # Create the API inbox as the signed-in administrator instead. The same
  # provisioning logic (minus Current.user) also backs the admin-copilot's
  # channel-connect tools via Api::V1::Internal::OpenchatToolsController.
  def ensure_openclaw_channel_inbox!(_channel_key, inbox_name)
    Openchat::ChannelInboxProvisioner.new(account: Current.account, inbox_name: inbox_name, user: Current.user).perform
  end
end
