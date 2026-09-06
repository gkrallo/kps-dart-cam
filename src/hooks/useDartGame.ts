import { useState, useCallback } from 'react';
import { DartScore, TurnRecord } from '../types';

export const useDartGame = (initialStartScore: number = 501) => {
  const [startScore, setStartScore] = useState<number>(initialStartScore);
  const [currentScore, setCurrentScore] = useState<number>(initialStartScore);
  const [currentTurnDarts, setCurrentTurnDarts] = useState<DartScore[]>([]);
  const [turnScoreBefore, setTurnScoreBefore] = useState<number>(initialStartScore);
  const [completedTurns, setCompletedTurns] = useState<TurnRecord[]>([]);
  const [isBust, setIsBust] = useState<boolean>(false);
  const [isWon, setIsWon] = useState<boolean>(false);

  // Register a new dart throw
  const registerDart = useCallback((dart: DartScore) => {
    if (isWon) return; // Game already finished

    // If previous throw was a bust, start new turn automatically
    let baseScore = currentScore;
    let turnDarts = currentTurnDarts;
    let turnStartScore = turnScoreBefore;

    if (isBust || turnDarts.length >= 3) {
      turnDarts = [];
      turnStartScore = baseScore;
      setTurnScoreBefore(baseScore);
      setIsBust(false);
    }

    const newScore = baseScore - dart.totalPoints;
    const isDoubleOut = dart.multiplier === 2;

    // Check Bust conditions:
    // 1. Score goes below 0
    // 2. Score becomes 1 (impossible to double out from 1)
    // 3. Score becomes 0 without a double
    const bust = newScore < 0 || newScore === 1 || (newScore === 0 && !isDoubleOut);

    if (bust) {
      // Revert score to start of turn
      const updatedTurnDarts = [...turnDarts, dart];
      const record: TurnRecord = {
        darts: updatedTurnDarts,
        scoreBeforeTurn: turnStartScore,
        scoreAfterTurn: turnStartScore,
        isBust: true,
      };

      setCurrentScore(turnStartScore);
      setCurrentTurnDarts(updatedTurnDarts);
      setIsBust(true);
      setCompletedTurns((prev) => [...prev, record]);
      return;
    }

    // Valid dart
    const updatedTurnDarts = [...turnDarts, dart];
    const won = newScore === 0 && isDoubleOut;

    setCurrentScore(newScore);
    setCurrentTurnDarts(updatedTurnDarts);

    if (won) {
      setIsWon(true);
      const record: TurnRecord = {
        darts: updatedTurnDarts,
        scoreBeforeTurn: turnStartScore,
        scoreAfterTurn: 0,
        isBust: false,
      };
      setCompletedTurns((prev) => [...prev, record]);
    } else if (updatedTurnDarts.length === 3) {
      // End of 3-dart turn
      const record: TurnRecord = {
        darts: updatedTurnDarts,
        scoreBeforeTurn: turnStartScore,
        scoreAfterTurn: newScore,
        isBust: false,
      };
      setCompletedTurns((prev) => [...prev, record]);
      setTurnScoreBefore(newScore);
    }
  }, [currentScore, currentTurnDarts, turnScoreBefore, isBust, isWon]);

  // Undo the last dart
  const undoLastDart = useCallback(() => {
    if (isWon) {
      setIsWon(false);
    }

    // Case 1: We have darts in the current active turn
    if (currentTurnDarts.length > 0) {
      const updatedDarts = [...currentTurnDarts];
      const removedDart = updatedDarts.pop()!;

      if (isBust) {
        setIsBust(false);
        // Calculate score from remaining darts in turn
        const restoredScore = turnScoreBefore - updatedDarts.reduce((acc, d) => acc + d.totalPoints, 0);
        setCurrentScore(restoredScore);
      } else {
        setCurrentScore((prev) => prev + removedDart.totalPoints);
      }

      setCurrentTurnDarts(updatedDarts);

      // If we just removed from a completed turn in history, pop the history
      if (completedTurns.length > 0) {
        const lastTurn = completedTurns[completedTurns.length - 1];
        if (lastTurn.darts.length === currentTurnDarts.length) {
          setCompletedTurns((prev) => prev.slice(0, -1));
        }
      }
      return;
    }

    // Case 2: Current turn is empty, undo from previous turn in history
    if (completedTurns.length > 0) {
      const updatedHistory = [...completedTurns];
      const lastTurn = updatedHistory.pop()!;
      setCompletedTurns(updatedHistory);

      const updatedDarts = [...lastTurn.darts];
      const removedDart = updatedDarts.pop()!;

      setTurnScoreBefore(lastTurn.scoreBeforeTurn);
      setIsBust(false);

      if (lastTurn.isBust) {
        const restoredScore = lastTurn.scoreBeforeTurn - updatedDarts.reduce((acc, d) => acc + d.totalPoints, 0);
        setCurrentScore(restoredScore);
      } else {
        setCurrentScore(lastTurn.scoreBeforeTurn - updatedDarts.reduce((acc, d) => acc + d.totalPoints, 0));
      }

      setCurrentTurnDarts(updatedDarts);
    }
  }, [currentTurnDarts, completedTurns, isBust, isWon, turnScoreBefore]);

  // Reset Game
  const resetGame = useCallback((newStartScore?: number) => {
    const score = newStartScore || startScore;
    if (newStartScore) setStartScore(newStartScore);
    setCurrentScore(score);
    setCurrentTurnDarts([]);
    setTurnScoreBefore(score);
    setCompletedTurns([]);
    setIsBust(false);
    setIsWon(false);
  }, [startScore]);

  return {
    startScore,
    currentScore,
    currentTurnDarts,
    turnScoreBefore,
    completedTurns,
    isBust,
    isWon,
    registerDart,
    undoLastDart,
    resetGame,
  };
};
