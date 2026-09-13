# frozen_string_literal: true

class Openchat::WhatsappComposeService
  class Error < StandardError; end

  def initialize(account:, user:)
    @account = account
    @user = user
  end

  # Create/reuse contact + conversation in WhatsApp (OpenClaw) inbox, send via bridge.
  def perform(phone:, content:)
    raise Error, 'phone is required' if phone.blank?
    raise Error, 'content is required' if content.blank?

    e164 = normalize_e164(phone)
    inbox = @account.inboxes.find_by(name: 'WhatsApp (OpenClaw)', channel_type: 'Channel::Api')
    raise Error, 'WhatsApp (OpenClaw) inbox not found — link WhatsApp first' unless inbox

    contact = find_or_create_contact!(e164)
    contact_inbox = ContactInbox.find_or_create_by!(contact: contact, inbox: inbox) do |ci|
      ci.source_id = e164
    end
    contact_inbox.update!(source_id: e164) if contact_inbox.source_id.blank?

    conversation = if inbox.lock_to_single_conversation?
                     contact_inbox.conversations.last
                   end
    conversation ||= Conversation.create!(
      account: @account,
      inbox: inbox,
      contact: contact,
      contact_inbox: contact_inbox
    )

    message = conversation.messages.create!(
      account: @account,
      inbox: inbox,
      message_type: :outgoing,
      content: content.to_s.strip,
      sender: @user,
      content_attributes: { openchat_outbound_synced: true }
    )

    Openchat::BridgeClient.new.send_whatsapp(
      account_id: @account.id,
      to: e164,
      text: content.to_s.strip,
      conversation_id: conversation.display_id
    )

    {
      contact_id: contact.id,
      conversation_id: conversation.display_id,
      message_id: message.id,
      to: e164
    }
  end

  private

  def find_or_create_contact!(e164)
    existing = @account.contacts.find_by(identifier: e164) ||
               @account.contacts.find_by(phone_number: e164)
    return existing if existing

    @account.contacts.create!(
      name: e164,
      phone_number: e164,
      identifier: e164
    )
  end

  def normalize_e164(raw)
    value = raw.to_s.strip
    return value if value.start_with?('+')

    digits = value.gsub(/\D/, '')
    return "+977#{digits}" if digits.length == 10 && digits.start_with?('9')
    return "+#{digits}" if digits.length >= 8

    raise Error, "invalid phone number: #{raw}"
  end
end
