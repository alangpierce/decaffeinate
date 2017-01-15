import { SourceType } from 'coffee-lex';

import NodePatcher from '../../../patchers/NodePatcher';
import canPatchAssigneeToJavaScript from '../../../utils/canPatchAssigneeToJavaScript';
import postfixExpressionRequiresParens from '../../../utils/postfixExpressionRequiresParens';
import type { PatcherContext, SourceToken } from './../../../patchers/types';

export default class ForPatcher extends NodePatcher {
  keyAssignee: ?NodePatcher;
  valAssignee: ?NodePatcher;
  target: NodePatcher;
  filter: ?NodePatcher;
  body: NodePatcher;

  constructor(patcherContext: PatcherContext, keyAssignee: ?NodePatcher, valAssignee: ?NodePatcher, target: NodePatcher, filter: ?NodePatcher, body: NodePatcher) {
    super(patcherContext);
    this.keyAssignee = keyAssignee;
    this.valAssignee = valAssignee;
    this.target = target;
    this.filter = filter;
    this.body = body;
  }

  patchAsExpression() {
    let bodyPrefixLine = null;
    if (this.keyAssignee) {
      // The key assignee can't be a complex expression, so we don't need to
      // worry about checking canPatchAssigneeToJavaScript.
      this.keyAssignee.patch();
    }
    if (this.valAssignee) {
      bodyPrefixLine = this.patchValAssignee();
    }
    this.target.patch();
    if (this.filter) {
      this.filter.patch();
    }

    if (this.isPostFor()) {
      this.surroundThenUsagesInParens();
      let forToken = this.getForToken();
      let forThroughEnd = this.slice(forToken.start, this.contentEnd);
      this.remove(this.body.outerEnd, this.contentEnd);
      this.insert(this.body.outerStart, `${forThroughEnd} then `);
    }

    if (bodyPrefixLine !== null) {
      this.body.insertLineBefore(bodyPrefixLine);
    }
    this.body.patch();
  }

  patchAsStatement() {
    this.patchAsExpression();
  }

  /**
   * Patch the value assignee, and if we need to add a line to the start of the
   * body, return that line. Otherwise, return null.
   */
  patchValAssignee() {
    if (canPatchAssigneeToJavaScript(this.valAssignee.node)) {
      this.valAssignee.patch();
      return null;
    } else {
      let assigneeName = this.claimFreeBinding('value');
      let assigneeCode = this.valAssignee.patchAndGetCode();
      this.overwrite(this.valAssignee.contentStart, this.valAssignee.contentEnd, assigneeName);
      return `${assigneeCode} = ${assigneeName}`;
    }
  }

  /**
   * @private
   */
  isPostFor(): boolean {
    return this.body.contentStart < this.target.contentStart;
  }

  /**
   * Defensively wrap expressions in parens if they might contain a `then`
   * token, since that would mess up the parsing when we rearrange the for loop.
   *
   * This method can be subclassed to account for additional fields.
   */
  surroundThenUsagesInParens() {
    if (postfixExpressionRequiresParens(this.slice(this.target.contentStart, this.target.contentEnd))) {
      this.target.surroundInParens();
    }
    if (this.filter &&
      postfixExpressionRequiresParens(this.slice(this.filter.contentStart, this.filter.contentEnd))) {
      this.filter.surroundInParens();
    }
  }

  /**
   * @private
   */
  getForToken(): SourceToken {
    if (this.isPostFor()) {
      let afterForToken = this.getFirstHeaderPatcher();
      let index = this.indexOfSourceTokenBetweenPatchersMatching(
        this.body, afterForToken,
        token => token.type === SourceType.FOR
      );

      if (!index) {
        throw this.error(`cannot find 'for' token in loop`);
      }

      return this.sourceTokenAtIndex(index);
    } else {
      let token = this.sourceTokenAtIndex(this.contentStartTokenIndex);

      if (!token || token.type !== SourceType.FOR) {
        throw this.error(`expected 'for' at start of loop`);
      }

      return token;
    }
  }

  /**
   * @private
   */
  getFirstHeaderPatcher(): NodePatcher {
    let candidates = [this.keyAssignee, this.valAssignee, this.target];
    let result = null;
    candidates.forEach(candidate => {
      if (!candidate) { return; }
      if (result === null || candidate.contentStart < result.contentStart) {
        result = candidate;
      }
    });
    if (result === null) {
      throw this.error(`cannot get first patcher of 'for' loop header`);
    }
    return result;
  }
}
