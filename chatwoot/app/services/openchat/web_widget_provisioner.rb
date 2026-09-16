# frozen_string_literal: true

# Creates a Chatwoot web-widget inbox, attaches the tenant's OpenClaw agent bot to it,
# and registers it with the openchat-bridge. Shared by the account-session-scoped
# Api::V1::Accounts::OpenchatController#web_widget (browser-driven) and the internal
# bridge-callback Api::V1::Internal::OpenchatToolsController#web_widget (agent-driven).
class Openchat::WebWidgetProvisioner
  DEFAULT_WIDGET_COLOR = '#1f93ff'.freeze

  def initialize(account:, website_url:, widget_color: nil, welcome_title: nil, welcome_tagline: nil, name: nil, user: nil)
    @account = account
    @website_url = website_url
    @widget_color = widget_color
    @welcome_title = welcome_title
    @welcome_tagline = welcome_tagline
    @name = name
    @user = user
  end

  def perform
    inbox = create_web_widget_inbox
    attach_openclaw_agent(inbox)
    Openchat::BridgeClient.new.register_web_widget(account_id: account.id, inbox_id: inbox.id)
    {
      id: inbox.id,
      name: inbox.name,
      web_widget_script: inbox.channel.web_widget_script,
      website_token: inbox.channel.website_token,
      ai_enabled: true
    }
  end

  private

  attr_reader :account, :website_url, :widget_color, :welcome_title, :welcome_tagline, :name, :user

  def create_web_widget_inbox
    channel = account.web_widgets.create!(
      website_url: website_url,
      widget_color: widget_color.presence || DEFAULT_WIDGET_COLOR,
      welcome_title: welcome_title.presence || account.name,
      welcome_tagline: welcome_tagline
    )
    inbox = account.inboxes.create!(name: name.presence || account.name, channel: channel)
    InboxMember.find_or_create_by!(inbox: inbox, user: user) if user
    inbox
  end

  def attach_openclaw_agent(inbox)
    Openchat::AttachOpenclawAgentService.new(account: account).perform(inbox)
  end
end
