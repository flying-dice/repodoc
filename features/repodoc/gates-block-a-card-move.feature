@status:verified @core
Feature: Gates block a card move

  A column may declare enter and exit gates. RepoDoc evaluates them before a
  card changes column, so a card only advances once the work the gates name has
  actually been done and recorded.

  Background:
    Given a board whose "review" column has an enter gate requiring a green `bun run test`

  Scenario: A card with no evidence may not enter the gated column
    Given a card in "doing" with no `## Gates` evidence
    When the card is moved to "review"
    Then the move is refused
    And the card file still records column "doing"

  Scenario: Recorded evidence satisfies the gate
    Given the card records `- [x] tests-passing — bun test green (claude, 2026-09-06T10:00:00.000Z)`
    When the card is moved to "review"
    Then the move succeeds
    And the card file records column "review"

  Scenario: A human override is recorded on the card
    Given a card whose enter gates fail
    When a human overrides the move with a reason
    Then the gate line records `OVERRIDDEN (<who>, <time>): <reason>`
