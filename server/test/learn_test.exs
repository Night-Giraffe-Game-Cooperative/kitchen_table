defmodule Family.LearnTest do
  use FamilyWeb.ConnCase, async: false
  alias Family.Learn

  test "Learn is an extra a new family starts without, and only an admin switches it on" do
    admin = admin_fixture()
    kid = person_fixture(admin, "kid", "Robin")
    jo = person_fixture(admin, "grownup", "Jo")
    alex = sign_in(build_conn() |> put_req_header("x-family", "1"), "alex@example.com", "a good password")

    assert %{"modules" => []} = alex |> get("/api/me") |> json_response(200)
    assert %{"error" => _} = alex |> get("/api/phrases") |> json_response(404)

    assert {:error, _} = Family.Modules.switch(kid, "learn", true)
    assert {:error, _} = Family.Modules.switch(jo, "learn", true)
    assert %{"error" => _} = alex |> put("/api/modules/chess", %{"on" => true}) |> json_response(422)

    FamilyWeb.Endpoint.subscribe("family:presence")
    assert %{"modules" => ["learn"]} = alex |> put("/api/modules/learn", %{"on" => true}) |> json_response(200)
    assert_receive %Phoenix.Socket.Broadcast{event: "modules_changed", payload: %{modules: ["learn"]}}
    assert %{"modules" => ["learn"]} = alex |> get("/api/me") |> json_response(200)
    assert %{"known" => []} = alex |> get("/api/phrases") |> json_response(200)

    # Switched off again, what everyone knows is kept for when it's back.
    :ok = Learn.mark(kid, "ja.thank_you", true)
    assert %{"modules" => []} = alex |> put("/api/modules/learn", %{"on" => false}) |> json_response(200)
    assert alex |> get("/api/phrases") |> json_response(404)
    assert Learn.keys(kid) == ["ja.thank_you"]
  end

  test "each person marks the phrases they know, and their own family sees it" do
    admin = admin_fixture()
    :ok = Family.Modules.switch(admin, "learn", true)
    kid = person_fixture(admin, "kid", "Robin")
    cousin = person_fixture(admin, "grownup", "Kim", %{"bubble_name" => "The cousins"})

    alex = sign_in(build_conn() |> put_req_header("x-family", "1"), "alex@example.com", "a good password")
    assert %{"ok" => true} = alex |> put("/api/phrases/known", %{"key" => "ja.thank_you", "known" => true}) |> json_response(200)
    # Saying so twice is fine.
    assert alex |> put("/api/phrases/known", %{"key" => "ja.thank_you", "known" => true}) |> json_response(200)
    :ok = Learn.mark(kid, "fr.hello", true)
    :ok = Learn.mark(kid, "ja.hira.ka", true)
    :ok = Learn.mark(cousin, "fr.hello", true)

    assert %{"known" => known} = alex |> get("/api/phrases") |> json_response(200)
    assert Enum.sort(known) ==
             Enum.sort([
               %{"user_id" => admin.id, "key" => "ja.thank_you"},
               %{"user_id" => kid.id, "key" => "fr.hello"},
               %{"user_id" => kid.id, "key" => "ja.hira.ka"}
             ])

    # Another household only sees its own.
    assert Learn.known_for(cousin) == [%{user_id: cousin.id, key: "fr.hello"}]

    # Not yet, after all.
    assert alex |> put("/api/phrases/known", %{"key" => "ja.thank_you", "known" => false}) |> json_response(200)
    refute Enum.any?(Learn.known_for(admin), &(&1.user_id == admin.id))

    # Only keys that name a phrase.
    assert %{"error" => _} = alex |> put("/api/phrases/known", %{"key" => "<b>hi</b>", "known" => true}) |> json_response(422)
    assert {:error, _} = Learn.mark(admin, "de.hallo", true)

    assert Learn.keys(kid) == ["fr.hello", "ja.hira.ka"]
  end

  test "a grown-up sets when the family goes, and everyone at home counts down" do
    admin = admin_fixture()
    :ok = Family.Modules.switch(admin, "learn", true)
    kid = person_fixture(admin, "kid", "Robin")
    cousin = person_fixture(admin, "grownup", "Kim", %{"bubble_name" => "The cousins"})

    alex = sign_in(build_conn() |> put_req_header("x-family", "1"), "alex@example.com", "a good password")
    assert %{"trips" => %{}} = alex |> get("/api/phrases") |> json_response(200)
    assert alex |> put("/api/phrases/trip", %{"lang" => "ja", "date" => "2027-04-03"}) |> json_response(200)
    assert %{"trips" => %{"ja" => "2027-04-03"}} = alex |> get("/api/phrases") |> json_response(200)
    assert Learn.trips(kid) == %{"ja" => "2027-04-03"}
    # Another household has its own holidays.
    assert Learn.trips(cousin) == %{}

    assert {:error, _} = Learn.set_trip(kid, "ja", "2027-05-01")
    assert {:error, _} = Learn.set_trip(admin, "ja", "next week")
    assert {:error, _} = Learn.set_trip(admin, "de", "2027-05-01")
    assert Learn.trips(kid) == %{"ja" => "2027-04-03"}

    # No date yet, after all.
    assert alex |> put("/api/phrases/trip", %{"lang" => "ja", "date" => nil}) |> json_response(200)
    assert Learn.trips(kid) == %{}
  end
end
