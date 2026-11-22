import type { UnknownAction } from '@reduxjs/toolkit';

import * as indexNodeJSON from '@suite/app-assets/files/guide/index.json';
import type { GuideCategory } from '@suite-common/suite-types';
import { variables } from '@trezor/components';

import {
    close,
    open,
    openGuideNode,
    setGuideView,
    setIndexNode,
    setWidth,
    unsetNode,
} from '#src/actions/suite/guideActions';

import { type GuideState } from './guideState';

const upstreamIndexNode = indexNodeJSON as GuideCategory;

// Suite Dark: no trading, so the Guide and its search leave out the Buy, Sell & Swap articles.
const indexNode: GuideCategory = {
    ...upstreamIndexNode,
    children: upstreamIndexNode.children.filter(({ id }) => id !== '/4_buy-sell-and-exchange'),
};

export const initialState: GuideState = {
    open: false,
    view: 'GUIDE_DEFAULT',
    indexNode,
    currentNode: null,
    width: variables.LAYOUT_SIZE.GUIDE_PANEL_DEFAULT_WIDTH,
};

// NOTE: we cannot use immer in this reducer, because GuideCategory mimics the react node and immer uses Object.freeze()
const guideReducer = (state: GuideState = initialState, action: UnknownAction): GuideState => {
    if (open.match(action)) {
        return { ...state, open: true };
    }
    if (close.match(action)) {
        return { ...state, open: false, view: 'GUIDE_DEFAULT' };
    }
    if (setGuideView.match(action)) {
        return { ...state, view: action.payload };
    }
    if (setIndexNode.match(action)) {
        return { ...state, indexNode: action.payload };
    }
    if (unsetNode.match(action)) {
        return { ...state, currentNode: null };
    }
    if (openGuideNode.match(action)) {
        return { ...state, currentNode: action.payload };
    }
    if (setWidth.match(action)) {
        return { ...state, width: action.payload };
    }

    return state;
};

export default guideReducer;
