@status:implemented @core @cli
Feature: A feature moves by its @status: tag

  Feature files are the specification AND the board card. Moving one may never
  disturb the file a test runner reads, so RepoDoc rewrites a single tag and
  nothing else.

  Scenario: Moving rewrites only the status tag
    Given a feature tagged `@status:specified`
    When I run `repodoc feature move <set> <feature> implemented`
    Then the file's `@status:` tag reads `implemented`
    And every other byte of the file is unchanged

  Scenario: A feature with no status tag gains one above the Feature line
    Given a feature file with no `@status:` tag
    When I move it to a column
    Then a `@status:<column>` tag line is inserted immediately above `Feature:`

  Scenario: An unknown status falls back to the first column
    Given a feature tagged `@status:nowhere`
    When the set is rendered as a board
    Then the feature appears in the first column
