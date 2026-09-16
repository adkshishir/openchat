class OpenchatPolicy < ApplicationPolicy
  def manage?
    @account_user.administrator?
  end

  alias web_widget? manage?
  alias agent_chat? manage?
  alias settings? manage?
  alias update_settings? manage?
  alias whatsapp_start? manage?
  alias whatsapp_wait? manage?
  alias whatsapp_finalize? manage?
  alias channels? manage?
  alias channel_connect? manage?
  alias channel_finalize? manage?
  alias whatsapp_compose? manage?
  alias model_auth? manage?
  alias openclaw_status? manage?
  alias openclaw_workspace? manage?
  alias openclaw_workspace_file? manage?
  alias update_openclaw_workspace_file? manage?
  alias knowledge_index? manage?
  alias knowledge_upload? manage?
  alias knowledge_destroy? manage?
  alias knowledge_search? manage?
end
