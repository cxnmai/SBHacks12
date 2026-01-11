import threading
import time
from typing import List


class ChatVelocityChart:
    """
    Thread-safe manager for chat velocity/rate data storage for chart visualization.
    """

    def __init__(self, max_points: int = 20000) -> None:
        """
        Initialize the chat velocity chart manager.

        Args:
            max_points: Maximum number of rate points to store (default: 200)
        """
        self._rates: List[float] = []
        self._points: List[tuple[float, float]] = []
        self._lock = threading.Lock()
        self._max_points = max_points

    def add_rate(self, rate: float, timestamp: float | None = None) -> None:
        """
        Add a new rate point to the chart data.
        Automatically limits the array size to prevent memory issues.

        Args:
            rate: Messages per second rate value
            timestamp: Unix timestamp for the rate point (defaults to now)
        """
        point_time = timestamp if timestamp is not None else time.time()
        with self._lock:
            self._rates.append(rate)
            self._points.append((point_time, rate))
            # Limit rates array to last max_points to prevent memory issues
            if len(self._rates) > self._max_points:
                self._rates = self._rates[-self._max_points :]
            if len(self._points) > self._max_points:
                self._points = self._points[-self._max_points :]

    def get_rates(self) -> List[float]:
        """
        Get a copy of the current rates array.
        Thread-safe.

        Returns:
            List of rate values (messages per second)
        """
        with self._lock:
            return list(self._rates)

    def get_points(self) -> List[dict]:
        """
        Get a copy of the current rate points with timestamps.

        Returns:
            List of dicts: {"timestamp": float, "rate": float}
        """
        with self._lock:
            return [{"timestamp": ts, "rate": rate} for ts, rate in self._points]

    def clear(self) -> None:
        """
        Clear all stored rates.
        Thread-safe.
        """
        with self._lock:
            self._rates.clear()
            self._points.clear()

    def count(self) -> int:
        """
        Get the number of stored rate points.
        Thread-safe.

        Returns:
            Number of rate points stored
        """
        with self._lock:
            return len(self._rates)
