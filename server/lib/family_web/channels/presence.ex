defmodule FamilyWeb.Presence do
  use Phoenix.Presence, otp_app: :family, pubsub_server: Family.PubSub
end
