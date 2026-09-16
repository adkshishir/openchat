# frozen_string_literal: true

# Machine-to-machine endpoint the openchat-bridge's admin-copilot MCP tools call
# into directly (not a browser/Devise session) to perform the ActiveRecord-side
# half of an admin tool call, e.g. creating a web-widget inbox. Authenticated by
# a shared secret header instead of a Chatwoot session, same idiom as the
# provision-secret check in Openchat::BridgeClient#provision.
class Api::V1::Internal::OpenchatToolsController < ActionController::API
  before_action :verify_bridge_secret!
  before_action :set_account

  # Declared first: Rails checks rescue_from handlers in reverse declaration order,
  # so the more specific handlers below still take precedence over this catch-all.
  # Needed for e.g. Whatsapp::ManualSetupValidationService raising a bare
  # StandardError on bad Meta/360dialog credentials — without this it would bubble
  # up as an unhandled 500 with an HTML body, which admin-tools.ts's JSON parsing
  # falls back to showing verbatim (a useless error message for the model/user).
  rescue_from StandardError do |error|
    render json: { error: error.message }, status: :unprocessable_entity
  end

  rescue_from Openchat::BridgeClient::Error do |error|
    render json: { error: error.message }, status: :bad_gateway
  end

  rescue_from ActiveRecord::RecordInvalid do |error|
    render json: { error: error.message }, status: :unprocessable_entity
  end

  def web_widget
    result = Openchat::WebWidgetProvisioner.new(
      account: @account,
      website_url: params.require(:website_url),
      widget_color: params[:widget_color],
      welcome_title: params[:welcome_title],
      welcome_tagline: params[:welcome_tagline],
      name: params[:name]
    ).perform
    render json: result
  end

  # Creates the Chatwoot Channel::Api inbox for a token-based OpenClaw channel
  # (Telegram, Discord, ...) once the bridge has already connected it on the
  # OpenClaw gateway side. Mirrors Openchat::Controller#ensure_openclaw_channel_inbox!.
  def channel_inbox
    inbox = Openchat::ChannelInboxProvisioner.new(account: @account, inbox_name: params.require(:inbox_name)).perform
    render json: { inbox_id: inbox.id }
  end

  # Native Chatwoot WhatsApp (Meta Cloud API) — delivery happens through Chatwoot
  # itself, not OpenClaw, so this creates a Channel::Whatsapp inbox instead of the
  # Channel::Api inboxes every other OpenClaw channel uses.
  def whatsapp_cloud
    setup = Whatsapp::ManualSetupService.new(
      account: @account,
      waba_id: params.require(:waba_id),
      phone_number_id: params.require(:phone_number_id),
      access_token: params.require(:access_token),
      inbox_name: params[:inbox_name]
    ).perform
    inbox = setup.channel.reload.inbox
    Openchat::AttachOpenclawAgentService.new(account: @account).perform(inbox)
    render json: { inbox_id: inbox.id, webhook_setup: setup.webhook_setup?, webhook_error: setup.webhook_error }
  end

  # Native Chatwoot WhatsApp via the 360dialog Business Solution Provider — same
  # native-delivery rationale as whatsapp_cloud above. 360dialog's own webhook
  # registration happens inside Channel::Whatsapp's provider_config validation.
  def whatsapp_360dialog
    channel = @account.whatsapp_channels.create!(
      phone_number: params.require(:phone_number),
      provider: 'default',
      provider_config: { api_key: params.require(:api_key) }
    )
    inbox = @account.inboxes.create!(name: params[:inbox_name].presence || 'WhatsApp (360dialog)', channel: channel)
    Openchat::AttachOpenclawAgentService.new(account: @account).perform(inbox)
    render json: { inbox_id: inbox.id }
  end

  private

  def verify_bridge_secret!
    secret = ENV.fetch('OPENCHAT_BRIDGE_INTERNAL_SECRET', nil)
    return head :unauthorized if secret.blank?

    header = request.headers['X-Openchat-Bridge-Secret'].to_s
    return head :unauthorized if header.blank?
    return head :unauthorized unless ActiveSupport::SecurityUtils.secure_compare(secret, header)
  end

  def set_account
    @account = Account.find_by(id: params[:account_id])
    head :not_found if @account.blank?
  end
end
