@status:verified @cli
Feature: The CLI refuses a gated move and prints the gate prompts

  `repodoc card move` is how an agent advances work. When gates block the move
  the refusal carries each failing gate's `prompt`, so the agent is handed the
  workflow to follow rather than a bare "no".

  Scenario: A refused move exits 1 and lists every failing gate
    Given a card whose target column has two failing enter gates
    When I run `repodoc card move <board> <card> review`
    Then the command exits 1
    And the output names both gates with their prompts

  Scenario: An override without a reason is a usage error
    When I run `repodoc card move <board> <card> done --override`
    Then the command exits 2
    And the output asks for `--reason <why>`

  Scenario: A successful move prints the target column's prompt
    Given the target column declares a `prompt`
    When the move succeeds
    Then the prompt is printed under "Now that <card> is in <column>:"
